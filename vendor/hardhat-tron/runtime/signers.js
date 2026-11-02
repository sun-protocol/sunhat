'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule(runtimeDeps) {
  // Multi-signer support for tests. The plugin derives N deterministic
  // secp256k1 keys from the well-known Hardhat mnemonic
  // "test test test … junk" at HD path `m/44'/60'/0'/0/i` and funds
  // each via `tre_setAccountBalance` on first use. TVM uses the same
  // curve and key→address derivation as Ethereum (only the address
  // prefix differs: 0x41 vs 0x00), so a given private key produces a
  // deterministic TVM base58 address.
  //
  // Each signer carries its own TronWeb instance bound to its private
  // key. `signMessage` / `signTypedData` operate offline via
  // `ethers.Wallet` — TVM verifies Ethereum-style RSV signatures
  // identically (same ECDSA curve, same hash algorithms), so contracts
  // that use `ECDSA.recover` (e.g. `ERC20Permit`, `ERC2771Forwarder`)
  // accept these signatures unchanged.
  //
  // State-changing call paths (`sendTransaction`, `predictAddress`)
  // route through the ethers bridge's raw-HTTP helpers; the bridge is
  // lazy-required inside each method to break a load-order cycle.

  const { ethers: ethersV6 } = require('ethers');
  const { TronWeb } = require('tronweb');

  const HARDHAT_MNEMONIC =
    'test test test test test test test test test test test junk';

  // Per-signer initial balance after funding. 5e18 sun ≈ 54% of
  // Long.MAX_VALUE — generous enough for tests that pass parseEther
  // values up to ~5 under the TVM pass-through unit model
  // (1 wei == 1 sun on the JS↔TVM boundary). Tests passing values
  // above Long.MAX_VALUE hit the TVM ceiling regardless of funding.
  const DEFAULT_BALANCE_SUN = 5_000_000_000_000_000_000n;
  const SIGNER_COUNT = 10;

  // Match the deployer TronWeb's 300 s HTTP timeout (see
  // `src/runtime/tre-web.js`). Each signer gets its own TronWeb
  // client, so each needs the same override.
  const HTTP_TIMEOUT_MS = 300_000;

  // Cache so `buildSigners()` returns the SAME array across calls in a
  // single test run — fixtures and per-test setup re-call it many times.
  let _cachedSigners = null;

  function deriveKey(index) {
    const wallet = ethersV6.HDNodeWallet.fromPhrase(
      HARDHAT_MNEMONIC,
      undefined,
      `m/44'/60'/0'/0/${index}`,
    );
    return { privateKey: wallet.privateKey, publicKey: wallet.publicKey };
  }

  // EIP-55 checksummed hex address from a private key, alongside the
  // underlying base58 TVM address. The 20-byte body is what contracts
  // see in `msg.sender` (after TVM's `0x41` prefix is stripped).
  function addressesFromKey(pk) {
    const pkNo0x = pk.startsWith('0x') ? pk.slice(2) : pk;
    const tronAddress = TronWeb.address.fromPrivateKey(pkNo0x);
    const hex21 = TronWeb.address.toHex(tronAddress);
    const checksum = ethersV6.getAddress('0x' + hex21.slice(2));
    return { tronAddress, address: checksum };
  }

  function buildTronWeb(hre, privateKey) {
    const { HttpProvider } = require('tronweb').providers;
    const url = hre.network.config.url.replace(/\/jsonrpc$/i, '');
    const pkNo0x = privateKey.startsWith('0x')
      ? privateKey.slice(2)
      : privateKey;
    const provider = new HttpProvider(url, HTTP_TIMEOUT_MS);
    return new TronWeb({ fullHost: provider, privateKey: pkNo0x });
  }

  // Signer object mirroring the ethers v6 Signer surface for the
  // methods OZ tests reach for. The `tronWeb` field is the per-signer
  // client; the bridge later wires `factory.connect(signer)` to route
  // writes through it so transactions sign with this signer's key.
  //
  // `deps.knownReceipts` and `deps.waitForReceipt` are supplied by the
  // bridge when it materializes the signer set for `getSigners()`;
  // they're consumed by `sendTransaction` to register the receipt with
  // the bridge's cache. When the signer is built standalone (e.g. for
  // the funding/`refundSigners` paths) those calls aren't used, so the
  // missing deps don't matter.
  function makeSigner(hre, privateKey, deps = {}) {
    const { tronAddress, address } = addressesFromKey(privateKey);
    const tronWeb = buildTronWeb(hre, privateKey);
    // `ethers.Wallet` for offline signing — the key material is what
    // matters; the wallet is never connected to a provider.
    const wallet = new ethersV6.Wallet(privateKey);

    // Three modes for `sendTransaction({to, value, data})`:
    //   1. `data` non-empty → contract call (sendCallTx via
    //      `/wallet/triggersmartcontract`; signs with this signer's
    //      key). Used by tests that send arbitrary calldata without
    //      going through the contract proxy.
    //   2. `data` empty + `value` > 0 → plain TRX transfer
    //      (`tronWeb.trx.sendTransaction`).
    //   3. Degenerate (no data + zero/no value) → throw, since neither
    //      TVM endpoint accepts an amount=0 transfer.
    async function sendTransaction({ to, value, data } = {}) {
      const { sendCallTx, valueToCallValue } = runtimeDeps.cheatcodes;
      const recipientBase58 = toBase58(to);
      const hasDataField = typeof data === 'string';

      let txId;
      if (hasDataField) {
        txId = await sendCallTx(tronWeb, {
          fromBase58: tronAddress,
          toBase58: recipientBase58,
          data,
          value,
        });
      } else {
        const amount = valueToCallValue(value);
        if (amount <= 0) {
          throw new Error(
            'sendTransaction({to, value, data}) requires either a `data` field or a positive `value`. ' +
              'TVM rejects amount=0 plain transfers.',
          );
        }
        const sent = await tronWeb.trx.sendTransaction(recipientBase58, amount);
        if (!sent.result) {
          throw new Error(`sendTransaction failed: ${JSON.stringify(sent)}`);
        }
        txId = sent.txid || (sent.transaction && sent.transaction.txID);
      }

      // Plain TransferContract txs don't surface an `info.receipt`
      // object (the receipt field is a contract-execution shape), so
      // polling for it would time out. Skip the poll for transfers and
      // synthesize an empty info; the call path still polls because it
      // needs `receipt.result` / logs.
      const waitForReceipt =
        deps.waitForReceipt || (hre.tre && hre.tre.waitForReceipt);
      const info =
        hasDataField && waitForReceipt
          ? await waitForReceipt(tronWeb, txId)
          : null;
      // Hook for EVM-pred → TVM-actual address mapping: record any CREATE
      // internal_txs from this receipt so subsequent `to:` lookups can rewrite.
      try {
        runtimeDeps.cheatcodes.registerCreateMappingsFromReceipt(info);
      } catch {
        /* */
      }
      // Receipt-result semantics differ between TransferContract (plain
      // TRX) and TriggerSmartContract (any `data` field, even '0x'):
      // only the latter populates `info.receipt.result`. Falling back
      // to status:0 would falsely flag every transfer as a revert;
      // gate the revert check on `hasDataField`.
      const succeeded = hasDataField
        ? info && info.receipt && info.receipt.result === 'SUCCESS'
        : true;
      const callValueSun = valueToCallValue(value);
      const feeSun = (info && info.fee) || 0;
      const energyFee =
        info && info.receipt && Number.isFinite(info.receipt.energy_fee)
          ? Number(info.receipt.energy_fee)
          : 0;
      const netFee =
        info && info.receipt && Number.isFinite(info.receipt.net_fee)
          ? Number(info.receipt.net_fee)
          : 0;
      const totalFeeSun = feeSun || energyFee + netFee;
      const receipt = {
        hash: '0x' + txId,
        transactionHash: '0x' + txId,
        status: succeeded ? 1 : 0,
        blockNumber: info ? info.blockNumber : undefined,
        logs: [],
        feeSun: totalFeeSun,
        internalTransactions: (info && info.internal_transactions) || [],
      };
      if (deps.knownReceipts) {
        deps.knownReceipts.set(receipt.hash, receipt);
      }
      if (hasDataField && !receipt.status) {
        // Lazy-require to break the bridge ↔ signers module-load cycle.
        const { buildRevertError } = runtimeDeps.bridge;
        throw buildRevertError(txId, info);
      }
      const { tronToHex } = runtimeDeps.bridge;
      return {
        hash: receipt.hash,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        from: tronToHex(tronAddress),
        to: tronToHex(recipientBase58),
        valueSun: callValueSun,
        feeSun: totalFeeSun,
        internalTransactions: receipt.internalTransactions,
        wait: async () => receipt,
      };
    }

    // Pre-compute and stash a `CreateSmartContract` tx for a future
    // `ethers.deployContract(name, args, this)` call. Returns the
    // checksummed EVM-style hex address the deploy WILL land at,
    // computed locally by TronWeb as
    // `0x41 || keccak256(txID || ownerAddress)[12:]` (identical to the
    // formula `WalletUtil.generateContractAddress` uses node-side).
    //
    // Use case: pre-compute a contract's address to pass it as an
    // immutable constructor arg into ANOTHER contract. The
    // ethers-EVM equivalent (`getCreateAddress({from, nonce})`) is
    // broken on TVM — both the formula differs and `nonce` is
    // meaningless. This method is the TVM-correct equivalent.
    async function predictAddress(name, args = []) {
      const bridge = runtimeDeps.bridge;
      const deploy = runtimeDeps.deploy;
      const artifact = bridge.loadArtifact(hre, name);
      const ctor = artifact.abi.find((a) => a.type === 'constructor');
      const ctorInputCount = ctor ? ctor.inputs.length : 0;

      // Mirror the bridge's overrides-splitting so the cache key and
      // the eventual broadcast see the same ctor-arg shape.
      const trailing = args[args.length - 1];
      const overrideKeys = [
        'value',
        'gasLimit',
        'gasPrice',
        'nonce',
        'from',
        'maxFeePerGas',
        'maxPriorityFeePerGas',
      ];
      const hasOverrides =
        trailing &&
        typeof trailing === 'object' &&
        !Array.isArray(trailing) &&
        overrideKeys.some((k) => k in trailing) &&
        args.length > ctorInputCount;
      const overrides = hasOverrides ? trailing : {};
      const ctorArgs = hasOverrides ? args.slice(0, -1) : args;

      let parameters;
      if (ctorArgs.length > 0 && ctor) {
        parameters = ctor.inputs.map((input, i) =>
          bridge.normalizeArg(ctorArgs[i], input),
        );
      }

      const deployOpts = { parameters };
      if (overrides.value !== null && overrides.value !== undefined) {
        const { valueToCallValue } = runtimeDeps.cheatcodes;
        const cv = valueToCallValue(overrides.value);
        deployOpts.callValue = typeof cv === 'bigint' ? cv.toString() : cv;
      }
      if (overrides.gasLimit !== null && overrides.gasLimit !== undefined) {
        deployOpts.feeLimit = Math.max(
          1,
          Math.min(1_000_000_000, Number(BigInt(overrides.gasLimit)) * 100),
        );
      }

      const { signedTx, predictedAddressTron } = await deploy.prebuildDeploy(
        tronWeb,
        tronAddress,
        artifact,
        deployOpts,
      );
      bridge._prebuildCache.set(
        bridge.prebuildCacheKey(tronAddress, name, args),
        { signedTx },
      );
      // TVM stores `contract_address` as `0x41 + 20 hex`. Strip the
      // prefix and EIP-55 checksum so it compares cleanly against
      // ethers' equally-checksummed read paths.
      const hex20 = predictedAddressTron.startsWith('41')
        ? predictedAddressTron.slice(2)
        : predictedAddressTron;
      return ethersV6.getAddress('0x' + hex20);
    }

    const signer = {
      address,
      tronAddress,
      privateKey,
      publicKey: wallet.signingKey.publicKey,
      tronWeb,
      // Filled in by the bridge so its stub provider stays the single
      // source of truth for read-side queries.
      provider: null,

      getAddress: async () => address,
      sendTransaction,
      predictAddress,

      // EIP-191 personal_sign. TVM's "Tron Signed Message:" prefix is
      // NOT used here — contracts that verify off-chain signatures use
      // `\x19Ethereum Signed Message:\n` (via OZ's
      // `MessageHashUtils.toEthSignedMessageHash`). `ethers.Wallet
      // .signMessage` produces that exact format, so signatures verify
      // on-chain unchanged.
      signMessage: async (msg) => wallet.signMessage(msg),

      // EIP-712 typed data. Domain separator includes chainId, which
      // for TVM on TRE is the network chain ID returned by
      // `eth_chainId` on the `/jsonrpc` endpoint. Callers typically
      // read it from the contract via `eip712Domain()` so the
      // signature matches the contract's view of the domain.
      signTypedData: async (domain, types, value) =>
        wallet.signTypedData(domain, types, value),

      // Tests sometimes do `signer.connect(provider)` to rebind to a
      // specific provider; return the same signer since our provider
      // is global.
      connect: () => signer,
    };
    return signer;
  }

  function toBase58(value) {
    if (!value) {
      return value;
    }
    if (typeof value === 'object' && typeof value.tronAddress === 'string') {
      return value.tronAddress;
    }
    // ethers v6 contract proxies expose `.target` instead of `.address`.
    if (typeof value === 'object' && typeof value.target === 'string') {
      return toBase58(value.target);
    }
    if (typeof value === 'object' && typeof value.address === 'string') {
      return toBase58(value.address);
    }
    if (typeof value !== 'string') {
      return value;
    }
    if (value.startsWith('T') && value.length === 34) {
      return value;
    }
    if (value.startsWith('0x') && value.length === 42) {
      return TronWeb.address.fromHex('41' + value.slice(2));
    }
    return value;
  }

  // Lazy-build N signers and fund each via `tre_setAccountBalance`. The
  // first call from a test run does the funding; subsequent calls
  // reuse the cached array.
  //
  // Funding is parallelized: `tre_setAccountBalance` is a direct
  // `AccountStore` mutation (not a transfer), so each call is
  // independent — no ordering constraint, no shared mutable state
  // across keys. Sequential funding would pay ~10×RTT (80–150 ms) at
  // the start of every fresh fixture; in parallel that's a single
  // ~10–15 ms wave. The HTTP keep-alive agent caps `maxSockets` at 50
  // so 10 concurrent requests share the same warm connection pool.
  async function buildSigners(hre, deps = {}) {
    if (_cachedSigners) {
      return _cachedSigners;
    }

    const { setAccountBalance } = runtimeDeps.cheatcodes;
    const { tronWeb: deployerTronWeb } = hre.tre.makeTronWeb();

    const configured = hre.network.config.accounts;
    const shouldFund = hre.config.tre.fundSigners === true;
    const keys = shouldFund
      ? Array.from({ length: SIGNER_COUNT }, (_, i) =>
          i === 0 ? configured[0] : deriveKey(i).privateKey,
        )
      : configured;
    const signers = keys.map((key) => makeSigner(hre, key, deps));
    if (!shouldFund) {
      _cachedSigners = signers;
      return signers;
    }

    // Fund every signer to `DEFAULT_BALANCE_SUN` (including index 0).
    // The docker-compose entrypoint pre-funds account 0 from the
    // genesis witness, but the witness budget caps the per-account
    // sweep below parseEther-scale balances. `tre_setAccountBalance`
    // mutates `AccountStore` directly so it sidesteps that ceiling.
    // Idempotent — safe across reruns and safe to run concurrently
    // (each call writes a distinct key).
    const results = await Promise.all(
      signers.map((s) =>
        setAccountBalance(
          deployerTronWeb,
          s.tronAddress,
          String(DEFAULT_BALANCE_SUN),
        ),
      ),
    );
    for (let i = 0; i < results.length; i++) {
      if (!results[i].supported) {
        throw new Error(
          `buildSigners: tre_setAccountBalance failed for index ${i}: ${results[i].reason}`,
        );
      }
    }

    _cachedSigners = signers;
    return signers;
  }

  // Re-fund all known signers to `DEFAULT_BALANCE_SUN`. Called by
  // `loadFixture` (and explicitly between test files) so cross-file
  // runs don't inherit a depleted state from a prior file's spending.
  // Idempotent at the cheatcode level (`tre_setAccountBalance` is a
  // direct write, not a transfer). No-op if signers haven't been
  // built yet.
  //
  // Parallelized for the same reason as `buildSigners`: each call
  // writes a distinct `AccountStore` key, so concurrency is safe and
  // removes ~9×RTT from the critical path of every fresh fixture.
  async function refundSigners(hre) {
    if (!_cachedSigners || hre.config.tre.fundSigners !== true) {
      return;
    }
    const { setAccountBalance } = runtimeDeps.cheatcodes;
    const { tronWeb: deployerTronWeb } = hre.tre.makeTronWeb();
    const results = await Promise.all(
      _cachedSigners.map((s) =>
        setAccountBalance(
          deployerTronWeb,
          s.tronAddress,
          String(DEFAULT_BALANCE_SUN),
        ),
      ),
    );
    for (let i = 0; i < results.length; i++) {
      if (!results[i].supported) {
        throw new Error(
          `refundSigners: tre_setAccountBalance failed for ${_cachedSigners[i].tronAddress}: ${results[i].reason}`,
        );
      }
    }
  }

  // Test-time reset hook. The signer set persists across `loadFixture`
  // re-runs by design (deterministic keys + pre-funded accounts), but
  // callers may want to force a fresh derivation.
  function _resetCache() {
    _cachedSigners = null;
  }

  return {
    buildSigners,
    refundSigners,
    toBase58,
    _resetCache,
    HARDHAT_MNEMONIC,
    DEFAULT_BALANCE_SUN,
    SIGNER_COUNT,
  };
};
