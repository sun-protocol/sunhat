'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule() {
  // Wrappers around the patched java-tron image's `tre_*` JSON-RPC
  // methods plus raw-HTTP helpers for transactions the ethers bridge
  // needs to issue without going through TronWeb's contract proxy
  // (impersonated owner_address, raw calldata, BigInt-safe call_value).
  // `tre_*` cheatcodes live on the `/tre` endpoint — the `/jsonrpc`
  // endpoint is the EVM-compat shim and does not expose `tre_*`.

  const { TronWeb } = require('tronweb');

  async function rpcCall(tronWeb, method, params = []) {
    const url = tronWeb.fullNode.host.replace(/\/$/, '') + '/tre';
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    // Single retry on a connection-level error ("fetch failed", TypeError,
    // AbortError). java-tron under G1GC with -Xmx2g can stop-the-world for
    // 50–200 ms late in long parallel runs as the chain state grows; a
    // pause that exceeds node's default fetch keep-alive timeout surfaces
    // as a TypeError here rather than as a server-side error code. One
    // 100 ms backoff catches those without masking real RPC failures
    // (which come back as `res.json()` with `error: {…}` and aren't
    // caught here).
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body,
      });
      return res.json();
    } catch (e) {
      if (!isTransientFetchError(e)) {
        throw e;
      }
      await new Promise((r) => setTimeout(r, 100));
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body,
      });
      return res.json();
    }
  }

  function isTransientFetchError(e) {
    if (!e) {
      return false;
    }
    const name = e.name || (e.constructor && e.constructor.name);
    if (name === 'AbortError' || name === 'TypeError') {
      return true;
    }
    const msg = String(e.message || e);
    return /fetch failed|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR/i.test(
      msg,
    );
  }

  // Surface "method not found" cleanly so callers can degrade rather
  // than throw. An unpatched fork returns an error object; cheatcodes
  // the patched fork supports return `{ supported: true, result }`.
  async function callOrFalse(tronWeb, method, params = []) {
    const r = await rpcCall(tronWeb, method, params).catch((e) => ({
      error: { message: e.message },
    }));
    if (r.error) {
      return { supported: false, reason: r.error.message };
    }
    return { supported: true, result: r.result };
  }

  const mine = (tw) => callOrFalse(tw, 'tre_mine', []);
  const setBlockTime = (tw, seconds) =>
    callOrFalse(tw, 'tre_blockTime', [seconds]);

  // State snapshot / revert — depends on the patched FullNode.jar.
  // The patch dumps (accountStore, codeStore, contractStore,
  // storageRowStore) into an in-memory map keyed by a returned id
  // ("0x1", "0x2", …). Revert restores the dumped state and discards
  // the snapshot id and any newer ids (matches Hardhat's `evm_revert`
  // semantics).
  //
  // Block number / timestamp are intentionally NOT rolled back. Tests
  // can rely on monotonically advancing blocks, but should re-warp
  // time after revert if they need a specific timestamp.
  const snapshot = (tw) => callOrFalse(tw, 'tre_snapshot', []);
  const revert = (tw, id) => callOrFalse(tw, 'tre_revert', [id]);

  // Account-state mutators. Each writes directly to the patched
  // FullNode's account / code / storage stores via `tre_*` JSON-RPC.
  //
  // `sun` is stringified before transport because TVM balances can
  // exceed 2^53 (Long.MAX_VALUE ≈ 9.22e18 sun); JSON-RPC integer
  // literals above 2^53 lose precision in the JS → Java round-trip
  // unless they go over the wire as strings.
  const setAccountBalance = (tw, addr, sun) =>
    callOrFalse(tw, 'tre_setAccountBalance', [addr, String(sun)]);
  const setAccountCode = (tw, addr, code) =>
    callOrFalse(tw, 'tre_setAccountCode', [addr, code]);
  const setAccountStorageAt = (tw, addr, slot, value) =>
    callOrFalse(tw, 'tre_setAccountStorageAt', [addr, slot, value]);

  // `unlockAccounts` adds a list of base58 addresses to a per-session
  // whitelist consulted by `TransactionCapsule.validateSignature`. Any
  // tx whose `owner_address` is on the list is accepted regardless of
  // which key signed it. Used by tests that need to send from accounts
  // they don't hold the private key for.
  const unlockAccounts = (tw, addrs) =>
    callOrFalse(tw, 'tre_unlockedAccounts', [addrs]);

  // Impersonation primitives. `tre_impersonateAccount` adds an address
  // to a static whitelist on `TransactionCapsule.validateSignature`,
  // so subsequent txs whose `owner_address` is on the list skip
  // ECRecover + permission/weight checks. Pair each server-side
  // impersonate with a `registerLocalImpersonation` so the bridge
  // signer set mirrors the server view — they MUST stay in sync.
  const impersonateAccount = (tw, addr) =>
    callOrFalse(tw, 'tre_impersonateAccount', [addr]);
  const stopImpersonatingAccount = (tw, addr) =>
    callOrFalse(tw, 'tre_stopImpersonatingAccount', [addr]);

  const _localImpersonations = new Set();
  function registerLocalImpersonation(base58) {
    _localImpersonations.add(base58);
  }
  function unregisterLocalImpersonation(base58) {
    _localImpersonations.delete(base58);
  }
  function isLocallyImpersonated(base58) {
    return _localImpersonations.has(base58);
  }

  // -- Unit model and BigInt-safe JSON serialization ----------------
  //
  // 1 wei == 1 sun (pass-through, no conversion). EVM uses 1e18 wei
  // per native unit and TVM uses 1e6 sun; converting at the JS↔TVM
  // boundary seemed natural at first, but it breaks any test where
  // Solidity STORES a value and re-uses it later (a Governor that
  // stores `value` at propose-time and re-emits it at execute-time
  // would try to send the converted figure, but the funding only
  // matched the pre-conversion one).
  //
  // Pass-through 1:1 sidesteps the issue entirely: what JS sends,
  // what Solidity stores, and what TVM debits are the same number.
  // `value` is bounded by Java's `Long` (`Long.MAX_VALUE` ≈ 9.22e18
  // sun), so tests using `parseEther("10")` and above will hit that
  // ceiling — verified ≤9e18 round-trips cleanly through
  // `/wallet/triggersmartcontract`'s `call_value` field.
  const WEI_PER_SUN = 1n;

  function weiToSun(value) {
    return typeof value === 'bigint' ? value : BigInt(value || 0);
  }

  // Coerce a value override (possibly undefined / Number / BigInt /
  // hex string) to a BigInt. java-tron's
  // `/wallet/triggersmartcontract` declares `call_value` as a Long
  // and accepts JSON integer literals up to `Long.MAX_VALUE` exactly
  // (the server-side parser handles integers natively, NOT as
  // IEEE-754 doubles). Callers that JSON-stringify the result MUST
  // use `jsonStringifyWithBigInts` to splice the BigInt in as a raw
  // JSON integer literal; round-tripping through JS `Number` would
  // quantize anything above 2^53 and silently shift transferred
  // amounts by ±1 wei.
  function valueToCallValue(value) {
    if (value === null || value === undefined) {
      return 0n;
    }
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new Error('Native value must be an exact integer');
    }
    const amount = typeof value === 'bigint' ? value : BigInt(value);
    if (amount < 0n || amount > 9223372036854775807n) {
      throw new Error('Native value is outside the TVM long range');
    }
    return amount;
  }

  // `JSON.stringify` throws on BigInt; sending `Number(bigint)` loses
  // precision above 2^53. Tag each BigInt with a sentinel string and
  // rewrite the sentinels with raw integer literals before returning.
  // Sentinel uses ASCII alphanumerics + underscores so it never gets
  // JSON-escaped — the regex-replace round-trips cleanly.
  function jsonStringifyWithBigInts(obj) {
    const SENTINEL_PREFIX = 'XBI_';
    const SENTINEL_SUFFIX = '_BIX';
    const replacer = (_, v) =>
      typeof v === 'bigint'
        ? SENTINEL_PREFIX + v.toString() + SENTINEL_SUFFIX
        : v;
    const raw = JSON.stringify(obj, replacer);
    return raw.replace(
      new RegExp(
        '"' + SENTINEL_PREFIX + '(-?\\d+)' + SENTINEL_SUFFIX + '"',
        'g',
      ),
      '$1',
    );
  }

  // -- Raw HTTP transaction helpers ---------------------------------
  //
  // Send a TVM tx with arbitrary calldata (selector + abi-encoded
  // args) and optional msg.value. Bypasses TronWeb's high-level
  // contract proxy so the caller can control `owner_address` (used
  // for impersonation) and pass raw `data` bytes when the ABI isn't
  // known to the bridge.
  //
  // `multisig: true` skips TronWeb's owner-key vs private-key check
  // inside `trx.sign` — required when the impersonated owner address
  // doesn't match the signing key. The patched
  // `TransactionCapsule.validateSignature` still accepts the tx via
  // the impersonation registry bypass.
  async function sendCallTx(
    tronWeb,
    { fromBase58, toBase58, data, value = 0n, multisig = false, feeLimit },
  ) {
    // EVM-predicted → TVM-actual rewrite. If `toBase58` is the EVM-simulator
    // address that a prior staticCall returned (e.g. from
    // `factory.$clone.staticCall(impl)`), route the broadcast to the actual
    // TVM-deployed address instead. See `_evmToTvm` above.
    const remapped = lookupTvmActualBase58(toBase58);
    if (remapped) {
      toBase58 = remapped;
    }

    const base = tronWeb.fullNode.host.replace(/\/$/, '');
    const dataHex =
      typeof data === 'string' && data.startsWith('0x')
        ? data.slice(2)
        : data || '';
    const triggerBody = jsonStringifyWithBigInts({
      owner_address: TronWeb.address.toHex(fromBase58),
      contract_address: TronWeb.address.toHex(toBase58),
      // When `data` is supplied directly (no function_selector),
      // java-tron's TriggerSmartContract handler uses it verbatim
      // as the transaction's `data` field — so we don't need to
      // know the function signature to send raw calldata.
      data: dataHex,
      // Caller-provided `feeLimit` (sun) honors `overrides.gasLimit`
      // from chai-matchers tests that probe OOG paths; default to
      // TRE's hard cap of 1_000_000_000 sun (≈ 10M energy @ 100
      // sun/energy) when unset.
      fee_limit:
        feeLimit !== null && feeLimit !== undefined
          ? Number(feeLimit)
          : 1_000_000_000,
      call_value: valueToCallValue(value),
      visible: false,
    });
    const doTrigger = () =>
      fetch(base + '/wallet/triggersmartcontract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: triggerBody,
      }).then((r) => r.json());

    let triggerJson = await doTrigger();
    if (
      !triggerJson.transaction ||
      (triggerJson.result && triggerJson.result.code)
    ) {
      // Auto-recover CONTRACT_VALIDATE_ERROR for EVM-level CREATE/CREATE2
      // contracts that have CodeStore bytecode but no ContractStore entry.
      // See maybeAutoRegisterContract above.
      const registered = await maybeAutoRegisterContract(
        tronWeb,
        toBase58,
        triggerJson,
      );
      if (registered) {
        triggerJson = await doTrigger();
      }
    }
    if (
      !triggerJson.transaction ||
      (triggerJson.result && triggerJson.result.code)
    ) {
      throw new Error(
        `triggersmartcontract failed: ${JSON.stringify(triggerJson)}`,
      );
    }

    const signed = await tronWeb.trx.sign(
      triggerJson.transaction,
      undefined,
      undefined,
      multisig,
    );

    const broadcastResp = await fetch(base + '/wallet/broadcasttransaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify(signed),
    });
    const broadcastJson = await broadcastResp.json();
    if (!broadcastJson.result) {
      const code =
        broadcastJson.code ||
        broadcastJson.message ||
        JSON.stringify(broadcastJson);
      const hint = /SIGERROR|signature/i.test(String(code))
        ? ' (impersonation requires the patched TransactionCapsule)'
        : '';
      throw new Error(`broadcast failed: ${code}${hint}`);
    }
    return signed.txID || broadcastJson.txid;
  }

  // Plain TRX transfer (TransferContract) with optional impersonated
  // owner. Builds via `/wallet/createtransaction`, signs with
  // `multisig` to bypass TronWeb's owner-key check, broadcasts.
  async function sendTransferTx(
    tronWeb,
    { fromBase58, toBase58, value, multisig = false },
  ) {
    const remapped = lookupTvmActualBase58(toBase58);
    if (remapped) {
      toBase58 = remapped;
    }

    const base = tronWeb.fullNode.host.replace(/\/$/, '');
    const amount = valueToCallValue(value);
    if (amount <= 0) {
      throw new Error(
        'sendTransferTx: amount must be > 0 — TVM rejects 0-amount transfers',
      );
    }
    const createResp = await fetch(base + '/wallet/createtransaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: jsonStringifyWithBigInts({
        owner_address: TronWeb.address.toHex(fromBase58),
        to_address: TronWeb.address.toHex(toBase58),
        amount,
        visible: false,
      }),
    });
    const createJson = await createResp.json();
    if (!createJson.txID) {
      throw new Error(
        `createtransaction failed: ${JSON.stringify(createJson)}`,
      );
    }
    const signed = await tronWeb.trx.sign(
      createJson,
      undefined,
      undefined,
      multisig,
    );
    const broadcastResp = await fetch(base + '/wallet/broadcasttransaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify(signed),
    });
    const broadcastJson = await broadcastResp.json();
    if (!broadcastJson.result) {
      throw new Error(
        `broadcast failed: ${broadcastJson.code || broadcastJson.message || JSON.stringify(broadcastJson)}`,
      );
    }
    return signed.txID || broadcastJson.txid;
  }

  // -- EVM-predicted → TVM-actual address mapping ---------------------
  //
  // Java-tron's triggerconstantcontract simulator computes CREATE/CREATE2
  // result addresses using EVM rules (keccak256(rlp(sender, nonce)) for
  // CREATE, keccak256(0xff || sender || salt || initcodehash) for CREATE2
  // -- which we patch in OZ Solidity to 0x41 but the simulator still uses
  // 0xff). The actual broadcast through TriggerSmartContract uses TVM
  // rules: CREATE address is keccak256(tx_root_id || sender_address) and
  // CREATE2 uses 0x41.
  //
  // This mismatch breaks the common test pattern:
  //     const addr = await factory.$clone.staticCall(impl);   // EVM-predicted
  //     await factory.$clone(impl);                           // TVM-actual deploy
  //     await signer.sendTransaction({ to: addr, ... });      // FAILS — addr doesn't exist
  //
  // We close the gap by tracking every CREATE in actual-broadcast
  // receipts. For each one we know `caller_address` + the actual deployed
  // address from the internal_transactions array. The simulator's
  // EVM-style prediction is whatever address it just returned to a prior
  // staticCall on the same caller; we queue those and pair by sequence —
  // the K-th staticCall return from a given contract is the simulator
  // prediction for the K-th broadcast CREATE from that contract. Once
  // we've mapped EVM-pred → TVM-actual, every subsequent send/staticCall
  // that targets the EVM-predicted address gets transparently rewritten.
  //
  // (Solidity-side OZ Clones is already patched to use 0x41 inside the
  // contracts; this map covers the off-chain staticCall-return path that
  // EVM rules govern in java-tron's simulator.)

  const _evmToTvm = new Map(); // lowercased 0x-hex EVM-pred → lowercased 0x-hex TVM-actual

  // Queue of recent simulator-returned addresses awaiting pairing with a
  // real CREATE from a receipt. Each entry is { callerTronHex,
  // returnedEvmHex }. Bounded so a long run can't grow this unboundedly.
  const _pendingStaticReturns = [];
  const _PENDING_LIMIT = 256;

  function recordStaticReturnAddress(callerTronBase58OrHex, returnedAddress) {
    if (!returnedAddress) {
      return;
    }
    const callerTronHex = (() => {
      const s = String(callerTronBase58OrHex || '');
      if (/^41[0-9a-f]{40}$/i.test(s)) {
        return s.toLowerCase();
      }
      if (/^0x41[0-9a-f]{40}$/i.test(s)) {
        return s.slice(2).toLowerCase();
      }
      if (s.startsWith('T') && s.length === 34) {
        try {
          return TronWeb.address.toHex(s).toLowerCase();
        } catch {
          return '';
        }
      }
      return '';
    })();
    if (!callerTronHex) {
      return;
    }

    let returnedEvmHex;
    if (typeof returnedAddress === 'string') {
      if (/^0x[0-9a-f]{40}$/i.test(returnedAddress)) {
        returnedEvmHex = returnedAddress.toLowerCase();
      } else if (
        returnedAddress.startsWith('T') &&
        returnedAddress.length === 34
      ) {
        try {
          returnedEvmHex =
            '0x' +
            TronWeb.address.toHex(returnedAddress).slice(2).toLowerCase();
        } catch {
          return;
        }
      }
    } else if (returnedAddress && typeof returnedAddress === 'object') {
      const t = returnedAddress.target || returnedAddress.address;
      if (typeof t === 'string') {
        return recordStaticReturnAddress(callerTronBase58OrHex, t);
      }
    }
    if (!returnedEvmHex) {
      return;
    }

    _pendingStaticReturns.push({ callerTronHex, returnedEvmHex });
    if (_pendingStaticReturns.length > _PENDING_LIMIT) {
      _pendingStaticReturns.shift();
    }
  }

  function _normalizeAddrToEvmHex(any) {
    if (!any) {
      return '';
    }
    // Unwrap ethers Contract / signer / addressable objects.
    if (typeof any === 'object') {
      if (typeof any.target === 'string') {
        return _normalizeAddrToEvmHex(any.target);
      }
      if (typeof any.tronAddress === 'string') {
        return _normalizeAddrToEvmHex(any.tronAddress);
      }
      if (typeof any.address === 'string') {
        return _normalizeAddrToEvmHex(any.address);
      }
      return '';
    }
    if (typeof any !== 'string') {
      return '';
    }
    const s = any;
    if (/^41[0-9a-f]{40}$/i.test(s)) {
      return '0x' + s.slice(2).toLowerCase();
    }
    if (/^0x41[0-9a-f]{40}$/i.test(s)) {
      return '0x' + s.slice(4).toLowerCase();
    }
    if (/^0x[0-9a-f]{40}$/i.test(s)) {
      return s.toLowerCase();
    }
    if (s.startsWith('T') && s.length === 34) {
      try {
        return '0x' + TronWeb.address.toHex(s).slice(2).toLowerCase();
      } catch {
        return '';
      }
    }
    return '';
  }

  // Public lookup: given any address form, return the TVM-actual base58
  // form if a mapping exists; else null. Used by the bridge / signers /
  // chai-matchers to rewrite EVM-predicted addresses before they hit the
  // chain.
  function lookupTvmActualBase58(any) {
    const k = _normalizeAddrToEvmHex(any);
    if (!k) {
      return null;
    }
    const actualEvmHex = _evmToTvm.get(k);
    if (!actualEvmHex) {
      return null;
    }
    try {
      return TronWeb.address.fromHex('41' + actualEvmHex.slice(2));
    } catch {
      return null;
    }
  }

  // Register every CREATE internal_tx from a receipt. Called by the bridge
  // after a successful broadcast that may have CREATE'd children.
  function registerCreateMappingsFromReceipt(info) {
    if (!info) {
      return;
    }
    const itxs = info.internal_transactions || info.internalTransactions;
    if (!Array.isArray(itxs) || itxs.length === 0) {
      return;
    }
    for (const itx of itxs) {
      // java-tron emits the note as hex-encoded UTF-8. "create" = 637265617465.
      const note = (itx.note || '').toString().toLowerCase();
      if (note !== '637265617465') {
        continue;
      }
      const callerHex = itx.caller_address && itx.caller_address.toLowerCase();
      const actualHex =
        itx.transferTo_address && itx.transferTo_address.toLowerCase();
      if (!callerHex || !actualHex) {
        continue;
      }

      const actualEvm = '0x' + actualHex.slice(2);

      // Pair by sequence (LIFO): the most recent pending static-return from
      // this caller is the simulator-prediction for this broadcast CREATE.
      // LIFO survives test failures between staticCall and the subsequent
      // broadcast — stale entries get pushed deeper rather than shifting
      // later pairings off by one. After a successful pairing, sweep older
      // same-caller entries (their broadcasts never landed).
      let paired = null;
      let pairedIdx = -1;
      for (let i = _pendingStaticReturns.length - 1; i >= 0; i--) {
        if (_pendingStaticReturns[i].callerTronHex === callerHex) {
          paired = _pendingStaticReturns[i];
          pairedIdx = i;
          break;
        }
      }
      if (paired) {
        _pendingStaticReturns.splice(pairedIdx, 1);
        for (let i = pairedIdx - 1; i >= 0; i--) {
          if (_pendingStaticReturns[i].callerTronHex === callerHex) {
            _pendingStaticReturns.splice(i, 1);
          }
        }
        _evmToTvm.set(paired.returnedEvmHex, actualEvm.toLowerCase());
      }
    }
  }

  // One-time access to ethers so this module doesn't take a hard dep on
  // it (sibling-chain spikes load cheatcodes without ethers).

  function setEthers(e) {
    void e;
  }

  // -- CONTRACT_VALIDATE_ERROR auto-recovery --------------------------
  //
  // java-tron only registers contracts in ContractStore when they're
  // deployed via CreateSmartContract transactions — contracts produced by
  // EVM-level CREATE/CREATE2 (EIP-1167 minimal proxies, OZ Clones) end up
  // with bytecode in CodeStore but NO entry in ContractStore. The
  // subsequent triggersmartcontract validation in
  // WalletApi#triggerContract (`if (deployedContract == null) throw "No
  // contract or not a valid smart contract"`) rejects the call.
  //
  // Recover by querying the address's code via eth_getCode (reads
  // CodeStore directly) and, if code exists, calling tre_setAccountCode
  // to force-register the address as a contract in ContractStore. Then
  // retry the trigger once.
  const _autoRegisteredAddresses = new Set();

  async function maybeAutoRegisterContract(tronWeb, toBase58, triggerJson) {
    const code = triggerJson && triggerJson.result && triggerJson.result.code;
    const messageHex =
      triggerJson && triggerJson.result && triggerJson.result.message;
    if (code !== 'CONTRACT_VALIDATE_ERROR' || !messageHex) {
      return false;
    }
    let msg = '';
    try {
      msg = Buffer.from(messageHex, 'hex').toString('utf8');
    } catch {
      /* */
    }
    if (!/No contract or not a valid smart contract/i.test(msg)) {
      return false;
    }
    if (_autoRegisteredAddresses.has(toBase58)) {
      return false;
    } // already tried, don't loop

    const base = tronWeb.fullNode.host.replace(/\/$/, '');
    const hexAddr = '0x' + TronWeb.address.toHex(toBase58).slice(2);
    let bytecode;
    try {
      const codeResp = await fetch(base + '/jsonrpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getCode',
          params: [hexAddr, 'latest'],
          id: 1,
        }),
      });
      const codeJson = await codeResp.json();
      bytecode = codeJson.result;
    } catch {
      return false;
    }
    if (!bytecode || bytecode === '0x' || bytecode === '0x0') {
      return false;
    }

    _autoRegisteredAddresses.add(toBase58);
    const r = await rpcCall(tronWeb, 'tre_setAccountCode', [
      toBase58,
      bytecode,
    ]);
    return r && r.result === true;
  }

  return {
    rpcCall,
    isTransientFetchError,
    callOrFalse,
    mine,
    setBlockTime,
    snapshot,
    revert,
    setAccountBalance,
    setAccountCode,
    setAccountStorageAt,
    unlockAccounts,
    impersonateAccount,
    stopImpersonatingAccount,
    registerLocalImpersonation,
    unregisterLocalImpersonation,
    isLocallyImpersonated,
    WEI_PER_SUN,
    weiToSun,
    valueToCallValue,
    jsonStringifyWithBigInts,
    sendCallTx,
    sendTransferTx,
    // EVM-pred → TVM-actual mapping (see _evmToTvm comment block).
    lookupTvmActualBase58,
    recordStaticReturnAddress,
    registerCreateMappingsFromReceipt,
    setEthers,
  };
};
