'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule(deps) {
  const { requestJson } = require('./transport');
  const {
    normalizeArguments,
    normalizeCallArguments,
    splitOverrides,
  } = require('./abi');
  // Replaces the network-touching surface of `hre.ethers` with a
  // TronWeb-backed equivalent so unmodified tests can run against the
  // local TRE container.
  //
  // This module ships the deploy surface:
  //
  //   hre.ethers.deployContract(name, args?, signer?)
  //     → load the Hardhat artifact, deploy via TronWeb, and return a
  //       Contract-shaped facade exposing `target`, `interface`,
  //       `deploymentTransaction()`, `waitForDeployment()`, and a
  //       method dispatch that routes view calls through
  //       `triggerconstantcontract` and state-changing calls through
  //       TronWeb's `.send()` path.
  //
  // Framework adapters call install with their connection-local context.
  const path = require('node:path');
  const fs = require('node:fs');
  const { ethers: ethersV6 } = require('ethers');
  const { TronWeb } = require('tronweb');
  // Shared address codecs from @openzeppelin/tron-runtime. `toEvmAddress`
  // returns a lowercase EVM `0x` address; `toBase58Address` returns a
  // checksummed `T…` base58 address. Both accept base58, 0x-EVM hex, and
  // 41-prefixed TRON hex. hardhat's wrappers below add EIP-55 checksumming
  // and the object/Typed unwrapping the bridge's callers rely on.
  const {
    toEvmAddress,
    toBase58Address,
  } = require('@openzeppelin/tron-runtime');

  const signersMod = deps.signers;
  const time = deps.time;
  const {
    rpcCall,
    sendCallTx,
    sendTransferTx,
    jsonStringifyWithBigInts,
    valueToCallValue,
  } = deps.cheatcodes;

  // -- Receipt registry + stub provider --------------------------------
  //
  // Mirror of the behaviour from test/helpers/ethers-facade.js. Stored
  // receipts are returned by `getTransactionReceipt(hash)` so chai-
  // matchers can resolve their lookups against the cached value.

  const knownReceipts = new Map();

  // LRU cap on knownReceipts. Every successful tx, every reverted tx,
  // every deploy, every sendTransaction lands here forever — unbounded
  // growth over a 30-min, 7500-test run accumulates 30k+ entries each
  // carrying decoded `logs[]` arrays plus `fragment` references that
  // pin Interface objects. By test ~5000 the map alone holds 100+ MB
  // and V8 spends real wall time in major GC. The matchers only look
  // up by hash within the same describe block's chain (and even that
  // is rare past the immediate `tx.wait()` resolution), so an
  // insertion-order LRU with a generous window is plenty.
  const _KNOWN_RECEIPTS_MAX = 2000;
  function rememberReceipt(hash, receipt) {
    knownReceipts.set(hash, receipt);
    if (knownReceipts.size > _KNOWN_RECEIPTS_MAX) {
      // Drop oldest 25% in one pass — keeps amortized cost O(1) instead
      // of trimming one entry per insertion at the limit.
      const dropCount =
        knownReceipts.size - Math.floor(_KNOWN_RECEIPTS_MAX * 0.75);
      const it = knownReceipts.keys();
      for (let i = 0; i < dropCount; i++) {
        knownReceipts.delete(it.next().value);
      }
    }
  }

  // Memoize ethers Interface + FunctionFragment per ABI fragment.
  // `staticCallWithRevertData`, `sendImpersonatedCall`, and
  // `makeMethod`'s tuple-input branch each allocate a fresh
  // single-function Interface + FunctionFragment PER CALL. The ABI
  // fragment object itself is stable per facade (it lives in the
  // artifact's abi[] array), so a WeakMap keyed by the fragment ref
  // reuses the parsed objects across all ~30k calls without leaking
  // when facades get GC'd.
  const _fragmentMemo = new WeakMap();
  function getFragmentAndIface(fnAbi) {
    let cached = _fragmentMemo.get(fnAbi);
    if (cached) {
      return cached;
    }
    cached = {
      fragment: ethersV6.FunctionFragment.from(fnAbi),
      iface: new ethersV6.Interface([fnAbi]),
    };
    _fragmentMemo.set(fnAbi, cached);
    return cached;
  }

  // stubProvider is shared by facades and signers within this connection.
  // The methods below are filled in at hook-time once `hre`
  // is available (we need TronWeb to actually query chain state).
  // Until then they return sane defaults for tests that probe them at
  // load time.
  const stubProvider = {
    _hre: null,
    _tw() {
      if (!this._hre) {
        return null;
      }
      return this._hre.tre.makeTronWeb().tronWeb;
    },
    async getTransactionReceipt(hash) {
      return knownReceipts.get(hash) || null;
    },
    async waitForTransaction(hash, confirmations = 1, timeout = 240000) {
      if (typeof hash !== 'string' || !/^(?:0x)?[a-fA-F0-9]{64}$/.test(hash)) {
        throw new Error('A native TRON transaction ID is required');
      }
      if (
        !Number.isSafeInteger(confirmations) ||
        confirmations < 0 ||
        confirmations > 1
      ) {
        throw new Error(
          'TRON waitForTransaction currently supports inclusion with zero or one confirmation',
        );
      }
      const txId = hash.replace(/^0x/, '').toLowerCase();
      const cached = knownReceipts.get('0x' + txId);
      if (cached) {
        return cached;
      }
      const info = await deps.context.tre.waitForReceipt(this._tw(), txId, {
        timeout,
      });
      const receipt = translateReceipt(txId, info);
      rememberReceipt('0x' + txId, receipt);
      return receipt;
    },
    async getNetwork() {
      const chainId = await deps.context.network.provider.request({
        method: 'eth_chainId',
      });
      return { chainId: BigInt(chainId), name: deps.context.network.name };
    },
    async getCode(address) {
      const tw = this._tw();
      if (!tw) {
        return '0x';
      }
      const addr = signersMod.toBase58(address);
      try {
        const info = await tw.trx.getContract(addr);
        if (info && info.bytecode) {
          return '0x' + info.bytecode;
        }
      } catch {
        /* fall through to eth_getCode */
      }
      // `getContract` reads ContractStore, which misses CREATE2-opcode
      // deployments (e.g. RelayedCall's assembly-`create2` relayer) — those
      // live in CodeStore. Fall back to `eth_getCode` on `/jsonrpc`, which
      // reads CodeStore. Same endpoint maybeAutoRegisterContract uses.
      try {
        const hexAddr = '0x' + TronWeb.address.toHex(addr).slice(2);
        const res = await requestJson(tw, '/jsonrpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getCode',
            params: [hexAddr, 'latest'],
            id: 1,
          }),
        });
        if (
          res &&
          typeof res.result === 'string' &&
          res.result !== '0x' &&
          res.result !== '0x0'
        ) {
          return res.result;
        }
      } catch {
        /* */
      }
      return '0x';
    },
    async getBalance(address) {
      const tw = this._tw();
      if (!tw) {
        throw new Error('TRON provider has no native client');
      }
      const addr = signersMod.toBase58(address);
      const account = await requestJson(tw, '/wallet/getaccount', {
        body: JSON.stringify({
          address: TronWeb.address.toHex(addr),
          visible: false,
        }),
      });
      if (
        !account ||
        typeof account !== 'object' ||
        Array.isArray(account) ||
        'Error' in account ||
        'error' in account ||
        'code' in account
      ) {
        throw new Error('Invalid TRON account response', { cause: account });
      }
      // Protobuf omits zero balances; an empty account denotes nonexistence.
      if (account.balance === undefined) {
        if (
          Object.keys(account).length !== 0 &&
          !(
            typeof account.address === 'string' &&
            TronWeb.isAddress(account.address)
          )
        ) {
          throw new Error('Invalid TRON account response');
        }
        return 0n;
      }
      const balance = account.balance;
      if (
        !(
          typeof balance === 'number' &&
          Number.isSafeInteger(balance) &&
          balance >= 0
        ) &&
        !(typeof balance === 'string' && /^\d+$/.test(balance))
      ) {
        throw new Error('Invalid TRON account balance');
      }
      return BigInt(balance);
    },
    async getBlockNumber() {
      const tw = this._tw();
      if (!tw) {
        return 0;
      }
      return time.latestBlock(tw);
    },
    async getBlock(blockHashOrNumber) {
      const tw = this._tw();
      if (!tw) {
        return null;
      }
      const tag =
        blockHashOrNumber === 'latest' ||
        blockHashOrNumber === null ||
        blockHashOrNumber === undefined
          ? undefined
          : blockHashOrNumber;
      const block = await (
        tag === undefined ? tw.trx.getCurrentBlock() : tw.trx.getBlock(tag)
      ).catch(() => null);
      if (!block) {
        return null;
      }
      // Project TVM's `transactions[]` array onto ethers v6's block
      // shape. Each entry has a `txID`; we expose hashes as `0x`-
      // prefixed strings, and synthesize `.getTransaction(idx)` so
      // tests that chain `block.getTransaction(0).then(tx =>
      // provider.getTransactionReceipt(tx.hash))` (e.g.
      // ERC2771Forwarder's `bubbles out of gas` post-revert receipt
      // read) find the right tx via knownReceipts.
      const txs = Array.isArray(block.transactions) ? block.transactions : [];
      const txHashes = txs.map((t) => '0x' + (t.txID || t.txId || ''));
      return {
        number: block.block_header && block.block_header.raw_data.number,
        timestamp:
          block.block_header &&
          Math.floor(block.block_header.raw_data.timestamp / 1000),
        hash: block.blockID ? '0x' + block.blockID : null,
        transactions: txHashes,
        getTransaction: async (idx) => {
          const hash = txHashes[idx];
          if (!hash) {
            return null;
          }
          return {
            hash,
            blockHash: block.blockID ? '0x' + block.blockID : null,
          };
        },
      };
    },
    async estimateGas(tx) {
      // TVM has no `eth_estimateGas` analog, but
      // `/wallet/triggerconstantcontract` returns `energy_used` from a
      // dry-run that mirrors EVM gas semantics under our 1:1
      // gas-to-energy mapping. Used by OZ's ERC2771Forwarder tests'
      // `estimateRequest` helper, which forms a synthetic call from
      // the forwarder to its target with the forwarded calldata + the
      // appended `from` address (ERC-2771 trailing-sender encoding).
      //
      // The TX shape is the ethers v6 transaction-request: `{from, to,
      // data, value, gasLimit}`. We map directly: `to → contract_address`,
      // `from → owner_address`, `data → data` (raw hex calldata).
      const tw = this._tw();
      if (!tw) {
        return 0n;
      }
      const from = signersMod.toBase58(tx.from);
      const to = signersMod.toBase58(tx.to);
      const data =
        typeof tx.data === 'string' && tx.data.startsWith('0x')
          ? tx.data.slice(2)
          : tx.data || '';
      const body = {
        owner_address: TronWeb.address.toHex(from),
        contract_address: TronWeb.address.toHex(to),
        data,
        visible: false,
      };
      const res = await requestJson(tw, '/wallet/triggerconstantcontract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonStringifyWithBigInts(body),
      }).catch(() => null);
      if (!res || (res.result && res.result.code)) {
        // Match ethers' shape on simulation failure — throw with revert
        // data so chai-matchers can match `revertedWith*`. Most callers
        // just want a numeric estimate; if the simulation reverts they
        // typically don't care about the data, only that something was
        // returned without an exception. Default to 21000n on error
        // rather than throwing, mirroring the loose "guess" behavior of
        // EVM clients on simulation failure.
        return 21000n;
      }
      return BigInt(res.energy_used || 21000);
    },
    async getStorage(address, slot) {
      const tw = this._tw();
      if (!tw) {
        throw new Error('TRON provider has no native client');
      }
      // Read the EXACT slot via `eth_getStorageAt` on `/jsonrpc`. The prior
      // `/tre debug_storageRangeAt` approach returned `Object.values(storage)[0]`
      // — the FIRST slot the node yields, NOT the requested one (java-tron's
      // storageRangeAt does not filter to the key) — so ERC-1967 slot reads
      // (proxy implementation/admin) came back as slot 0 (the impl's `value`).
      // `eth_getStorageAt` is exact.
      const addr = signersMod.toBase58(address);
      const slotHex = ethersV6.toBeHex(slot, 32);
      const hexAddr = '0x' + TronWeb.address.toHex(addr).slice(2);
      const res = await requestJson(tw, '/jsonrpc', {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getStorageAt',
          params: [hexAddr, slotHex, 'latest'],
        }),
      });
      if (
        !res ||
        typeof res !== 'object' ||
        Array.isArray(res) ||
        'error' in res ||
        typeof res.result !== 'string' ||
        !/^0x(?:[0-9a-fA-F]{2}){0,32}$/.test(res.result)
      ) {
        throw new Error('Invalid TRON storage response', { cause: res });
      }
      return ethersV6.zeroPadValue(res.result, 32);
    },
    // ethers v6 routes `view`/`pure` Contract methods (and explicit
    // `.staticCall`) through `runner.call(tx)`. The facade path
    // (deployContract / getContractAt) intercepts these itself, but a native
    // `new ethers.Contract(addr, abi, provider)` — e.g. the test helper
    // `forceDeployCode` layered over `setCode` — calls straight through to here.
    // Forward the raw calldata to `/wallet/triggerconstantcontract` and return
    // the raw result hex; ethers performs the ABI decode. Mirrors estimateGas.
    async call(tx) {
      const tw = this._tw();
      if (!tw) {
        return '0x';
      }
      const toAddr = signersMod.toBase58(tx.to);
      const fromAddr = tx.from ? signersMod.toBase58(tx.from) : toAddr;
      const data =
        typeof tx.data === 'string' && tx.data.startsWith('0x')
          ? tx.data.slice(2)
          : tx.data || '';
      const body = {
        owner_address: TronWeb.address.toHex(fromAddr),
        contract_address: TronWeb.address.toHex(toAddr),
        data,
        call_value: valueToCallValue(tx.value),
        visible: false,
      };
      const res = await requestJson(tw, '/wallet/triggerconstantcontract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonStringifyWithBigInts(body),
      });
      // A successful constant call reports `result.result === true`; a revert
      // sets `result.code`/`result.message` and puts the revert bytes in
      // `constant_result[0]` (same detection as staticCallWithRevertData).
      const reverted =
        res &&
        res.result &&
        (res.result.result === false || res.result.code || res.result.message);
      const raw =
        res && res.constant_result && res.constant_result[0]
          ? '0x' + res.constant_result[0]
          : '0x';
      if (reverted) {
        // Surface revert data on a CALL_EXCEPTION so ethers / chai-matchers can
        // decode it (revertedWith / revertedWithCustomError) instead of
        // mis-decoding a 4-byte error selector as return data.
        const err = new Error('execution reverted (TVM constant call)');
        err.code = 'CALL_EXCEPTION';
        err.data = raw;
        throw err;
      }
      return raw;
    },
  };

  // -- Address conversion ---------------------------------------------
  //
  // Hot-path: every tx response, every event log, every staticCall
  // argument round-trips an address through one of these. Each
  // conversion does either base58 → hex21 (sha256d checksum verify) or
  // hex → EIP-55 (keccak256). Across ~30k txs × multiple addresses each
  // these allocations and hashes are non-trivial. We cache the
  // string→string mapping in bounded LRU-ish Maps — pure functions, so
  // caching is safe; bounded because a long run with many unique
  // addresses (CREATE2 spam tests) shouldn't grow memory unbounded.

  const _ADDR_CACHE_MAX = 4096;
  const _hexCache = new Map(); // key: any-string input → checksummed 0x-hex
  const _base58Cache = new Map(); // key: 0x-hex or 41-hex string → T... base58

  function _trimCache(m) {
    if (m.size <= _ADDR_CACHE_MAX) {
      return;
    }
    // Map iteration follows insertion order; drop the oldest 25% so we
    // don't trim on every set when at the limit.
    const dropCount = m.size - Math.floor(_ADDR_CACHE_MAX * 0.75);
    const it = m.keys();
    for (let i = 0; i < dropCount; i++) {
      m.delete(it.next().value);
    }
  }

  // Returns an EIP-55-checksummed 0x-hex address. Tests that compare
  // against ethers utilities (`getCreate2Address`, `getAddress`, etc)
  // expect the checksummed form, and ethers' string equality is
  // case-sensitive — so we always emit checksummed here.
  function tronToHex(addr) {
    if (!addr) {
      return addr;
    }
    if (typeof addr !== 'string') {
      // Non-string (Addressable / object): preserve the prior TronWeb
      // path — the runtime codec only accepts strings.
      return ethersV6.getAddress('0x' + TronWeb.address.toHex(addr).slice(2));
    }
    const cached = _hexCache.get(addr);
    if (cached !== undefined) {
      return cached;
    }
    // Delegate the base58 / 0x-EVM / 41-hex → EVM conversion to the shared
    // runtime codec, then re-checksum via ethers.getAddress. The runtime
    // emits a lowercase EVM address; hardhat's callers compare against
    // ethers utilities (getCreate2Address, getAddress) whose output is
    // EIP-55-checksummed and case-sensitively equal, so the getAddress
    // wrap is load-bearing. Proven equal to the old implementation on real
    // inputs (6/6) prior to adoption.
    const result = ethersV6.getAddress(toEvmAddress(addr));
    _hexCache.set(addr, result);
    _trimCache(_hexCache);
    return result;
  }

  function toTronBase58(addr) {
    // Handle Addressable / Signer / Contract-like objects that callers
    // pass through `ethers.getContractAt(name, contractInstance)` and
    // `factory.attach(otherContract)`. Without this, the object falls
    // through and downstream `TronWeb.address.toHex(obj)` returns '0x',
    // which `ethersV6.getAddress` rejects with "invalid address 0x".
    if (addr && typeof addr === 'object') {
      if (typeof addr.tronAddress === 'string') {
        return addr.tronAddress;
      }
      if (typeof addr.target === 'string') {
        return toTronBase58(addr.target);
      }
      if (typeof addr.address === 'string') {
        return toTronBase58(addr.address);
      }
    }
    if (typeof addr !== 'string') {
      return addr;
    }
    if (addr.startsWith('T') && addr.length === 34) {
      return addr;
    }
    const cached = _base58Cache.get(addr);
    if (cached !== undefined) {
      return cached;
    }
    // Only the two forms the prior implementation recognized (0x-EVM hex,
    // 41-prefixed TRON hex) are converted; anything else falls through
    // unchanged. The runtime codec would throw on unrecognized input, but
    // hardhat's contract here is to return the value as-is — so gate the
    // codec call on the recognized forms and delegate the conversion.
    let result;
    if (
      (addr.startsWith('0x') && addr.length === 42) ||
      /^41[0-9a-fA-F]{40}$/.test(addr)
    ) {
      result = toBase58Address(addr);
    } else {
      return addr;
    }
    _base58Cache.set(addr, result);
    _trimCache(_base58Cache);
    return result;
  }

  // Pull a plain address string out of:
  //   - a `0x...` / TRON `T...` literal
  //   - a signer- or contract-like object with `.address`
  //   - an `ethers.Typed` wrapper ({ type, value }) around any of the above
  //     — tests use `ethers.Typed.address(signer)` for overload disambiguation
  function asAddressString(value) {
    // ethers.Typed wrapper — recurse so nested `Typed.address(signer)` works.
    if (
      value &&
      typeof value === 'object' &&
      typeof value.type === 'string' &&
      'value' in value
    ) {
      return asAddressString(value.value);
    }
    // Signer- or Contract-like object with a string `.address` property.
    if (
      value &&
      typeof value === 'object' &&
      typeof value.address === 'string'
    ) {
      return value.address;
    }
    return value;
  }

  // -- Receipt translation --------------------------------------------

  // `iface` is an ethers v6 Interface for the contract that emitted the
  // logs - used to decode each log into `{fragment, args}` so upstream
  // OZ tests can do `receipt.logs.find(e => e.fragment.name === 'X')`
  // and `event.args[0]`. If a log's topic0 isn't in `iface` (e.g. logs
  // from a different contract called during the tx), the log is left
  // without a fragment but still has raw topics/data.
  function translateReceipt(txId, info, iface = null) {
    // Total TVM fee = energy_fee + net_fee (both sun). Used by the
    // ether-balance chai matcher to back out gas cost from the
    // sender's notional balance change. info.fee is the precomputed
    // sum when populated.
    const energyFee =
      info && info.receipt && Number.isFinite(info.receipt.energy_fee)
        ? Number(info.receipt.energy_fee)
        : 0;
    const netFee =
      info && info.receipt && Number.isFinite(info.receipt.net_fee)
        ? Number(info.receipt.net_fee)
        : 0;
    const feeSun =
      info && info.fee !== null && info.fee !== undefined
        ? Number(info.fee)
        : energyFee + netFee;
    // TVM tracks energy (≈ EVM gas) separately from sun-denominated
    // fees. Expose `energy_usage_total` as `gasUsed` so OZ tests that
    // probe gas-meter semantics — e.g. ERC2771Forwarder's `bubbles out
    // of gas` (asserts `gasUsed == gasLimit` after an inner OOG burns
    // all remaining energy via `invalid()`) — see a value with the same
    // units they expect on EVM. java-tron's `INVALID` handler routes
    // through `Program.spendAllEnergy()`, so on a full-burn the
    // receipt reports `energy_usage_total == feeLimit / energy_price`;
    // the bridge maps `gasLimit → feeLimit = gasLimit * 100`, so the
    // ratio inverts cleanly back to gasLimit.
    const energyUsed =
      info && info.receipt && Number.isFinite(info.receipt.energy_usage_total)
        ? BigInt(info.receipt.energy_usage_total)
        : 0n;
    return {
      nativeTransactionId: txId,
      nativeReceipt: info?.receipt,
      nativeTransactionInfo: info,
      hash: '0x' + txId,
      transactionHash: '0x' + txId,
      status: info && info.receipt && info.receipt.result === 'SUCCESS' ? 1 : 0,
      blockNumber: info ? info.blockNumber : undefined,
      gasUsed: energyUsed,
      cumulativeGasUsed: energyUsed,
      // chai-matchers' canonical changeEtherBalance does a
      // `provider.send("eth_getBlockByHash", [blockHash, false])`
      // probe; we don't serve that, and the upstream-style matcher is
      // replaced by the TVM-aware chai matchers module. blockHash is exposed
      // for tests that read it directly. java-tron's `blockHash` is
      // not on the unconfirmed-info shape, so this is best-effort.
      blockHash:
        info && info.blockHash
          ? info.blockHash.startsWith('0x')
            ? info.blockHash
            : '0x' + info.blockHash
          : undefined,
      // Fee in sun. Stored under `feeSun` (not `gasUsed * gasPrice`)
      // because TVM accounts for energy + bandwidth separately and the
      // direct sun figure is what the FullNode reports.
      feeSun,
      logs: ((info && info.log) || []).map((l, i) => {
        const log = {
          address: l.address ? '0x' + l.address : undefined,
          topics: (l.topics || []).map((t) =>
            t.startsWith('0x') ? t : '0x' + t,
          ),
          data: l.data
            ? l.data.startsWith('0x')
              ? l.data
              : '0x' + l.data
            : '0x',
          logIndex: i,
          index: i, // ethers v6 alias
          transactionHash: '0x' + txId,
          blockNumber: info ? info.blockNumber : undefined,
          removed: false,
        };
        if (iface) {
          try {
            const parsed = iface.parseLog({
              topics: log.topics,
              data: log.data,
            });
            if (parsed) {
              log.fragment = parsed.fragment;
              log.args = parsed.args;
              log.eventName = parsed.name;
              log.eventSignature = parsed.signature;
            }
          } catch {
            /* log emitted by another contract or unknown topic — leave undecorated */
          }
        }
        return log;
      }),
      // Pass through internal value-transfer descriptors for the TVM
      // ether-balance matcher. Shape: see tronweb/src/types/Trx.ts —
      // each entry has caller_address (21-byte hex with 41 prefix),
      // transferTo_address, callValueInfo[] with sun callValue, and
      // rejected flag (true = inner CALL reverted, skip).
      internalTransactions: (info && info.internal_transactions) || [],
      contractAddress: info ? info.contract_address : undefined,
    };
  }

  function buildRevertError(txId, info) {
    const result = info && info.receipt && info.receipt.result;
    const raw =
      info && info.contractResult && info.contractResult[0]
        ? info.contractResult[0]
        : '';
    const data = raw ? '0x' + raw : '0x';
    let reason = null;
    if (data.startsWith('0x08c379a0')) {
      try {
        reason = ethersV6.AbiCoder.defaultAbiCoder().decode(
          ['string'],
          '0x' + data.slice(10),
        )[0];
      } catch {
        /* leave reason null */
      }
    }
    const msg = reason
      ? `transaction reverted with reason: ${reason}`
      : `transaction reverted (result=${result || 'unknown'}, data=${data})`;
    const err = new Error(msg);
    err.data = data;
    err.reason = reason;
    err.txHash = '0x' + txId;
    err.receipt = translateReceipt(txId, info);
    // Stash the failed-tx receipt so tests that follow the chai
    // rejection with a separate `provider.getTransactionReceipt(hash)`
    // probe (e.g. ERC2771Forwarder's `bubbles out of gas` reads
    // `gasUsed` from a receipt-fetch AFTER asserting the rejection)
    // can still find the receipt. Without this, the chain has the tx
    // (it was mined; only execution reverted), but the bridge's
    // `stubProvider.getTransactionReceipt` cache misses.
    rememberReceipt('0x' + txId, err.receipt);
    return err;
  }

  // -- Method invocation ----------------------------------------------

  function canonicalSig(fnAbi) {
    return ethersV6.FunctionFragment.from(fnAbi).format('sighash');
  }

  // `triggerConstantContract` throws `Error("REVERT opcode executed")`
  // and STRIPS all `constant_result` from the error — chai-matchers
  // can't match `revertedWithCustomError` against an error with no
  // `.data`. We bypass TronWeb's wrapper and POST to the underlying
  // `/wallet/triggerconstantcontract` HTTP endpoint directly, where the
  // response always contains `constant_result` (whether the call
  // succeeded or reverted).
  async function staticCallWithRevertData(
    fnAbi,
    tronContract,
    tronWeb,
    normalized,
    overrides = {},
  ) {
    const { fragment: ifaceFragment, iface } = getFragmentAndIface(fnAbi);
    const sig = canonicalSig(fnAbi);

    // Encode args via ethers (handles addresses, tuples, dynamic types
    // correctly) — then strip the 4-byte selector to get just the
    // parameter bytes that triggerconstantcontract expects.
    const calldata = iface.encodeFunctionData(ifaceFragment, normalized);
    const parameter = calldata.slice(10); // strip 0x + selector

    // Owner-address override for impersonated callers — view calls
    // honor `msg.sender` checks (e.g. AccessManaged.canCall predicates)
    // against the override even though `triggerconstantcontract` doesn't
    // verify the owner's signature. Falls back to the TronWeb's default
    // address when no override is set.
    const ownerBase58 =
      tronWeb._impersonatedFrom || tronWeb.defaultAddress.base58;
    const body = {
      owner_address: TronWeb.address.toHex(ownerBase58),
      contract_address: TronWeb.address.toHex(tronContract.address),
      function_selector: sig,
      parameter,
      call_value: valueToCallValue(overrides.value ?? 0),
      visible: false,
    };
    const res = await requestJson(tronWeb, '/wallet/triggerconstantcontract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonStringifyWithBigInts(body),
    });

    // Successful call: result.result === true (only field) AND no
    // contract_result code. On revert, `result.code` is set and
    // `constant_result[0]` holds the revert bytes.
    const reverted =
      res.result &&
      (res.result.result === false || res.result.code || res.result.message);
    const raw =
      res.constant_result && res.constant_result[0]
        ? '0x' + res.constant_result[0]
        : '0x';

    if (!reverted) {
      const decoded = iface.decodeFunctionResult(ifaceFragment, raw);
      return decoded.length === 1 ? decoded[0] : decoded;
    }

    // Decode only the bytes returned by this execution. Bytecode and
    // argument values cannot establish why a call reverted.
    throw (tronContract._iface || iface).makeError(raw, {
      to: tronToHex(tronContract.address),
      from: tronToHex(ownerBase58),
      data: calldata,
    });
  }

  // State-changing call from an impersonated owner_address.
  //
  // TronWeb's `contract().method().send()` hardwires `owner_address`
  // to its TronWeb's default address, so to make `msg.sender` reflect
  // the impersonated address we bypass the high-level path entirely:
  //
  //   1. encode calldata via ethers
  //   2. POST /wallet/triggersmartcontract with `owner_address = imp`
  //   3. sign the returned unsigned tx with the deployer's key (we
  //      don't have `imp`'s key — that's the whole point)
  //   4. POST /wallet/broadcasttransaction
  //
  // The patched fork's TransactionCapsule.validateSignature sees that
  // owner_address is on TreImpersonationRegistry and skips ECRecover,
  // accepting the tx despite the signature ECRecovering to the
  // deployer.
  async function sendImpersonatedCall(
    fnAbi,
    contractTronBase58,
    fromTronBase58,
    normalized,
    deployerTronWeb,
    overrides = {},
  ) {
    const { fragment: ifaceFragment, iface } = getFragmentAndIface(fnAbi);
    const sig = canonicalSig(fnAbi);
    const calldata = iface.encodeFunctionData(ifaceFragment, normalized);
    const parameter = calldata.slice(10);

    // msg.value override. 1 wei == 1 sun pass-through on the JS↔TVM
    // boundary; see the unit-model comment in cheatcodes.js.
    let callValueSun = 0;
    if (overrides.value !== null && overrides.value !== undefined) {
      callValueSun = valueToCallValue(overrides.value);
    }

    // `callValueSun` can be a BigInt (anything above 2^53 sun ≈ ~9e15
    // would lose precision under Number coercion — VestingWallet /
    // proxy-with-value tests send `parseEther("1") = 1e18` here). Use
    // the BigInt-safe JSON serializer; java-tron parses `call_value`
    // as a Long.
    const triggerJson = await requestJson(
      deployerTronWeb,
      '/wallet/triggersmartcontract',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonStringifyWithBigInts({
          owner_address: TronWeb.address.toHex(fromTronBase58),
          contract_address: TronWeb.address.toHex(contractTronBase58),
          function_selector: sig,
          parameter,
          // Default to TRE's 1_000_000_000 sun (≈10M energy @ 100
          // sun/energy) ceiling. Honor `overrides.feeLimit` (already
          // mapped from `overrides.gasLimit` by `makeMethod.invoke`)
          // when supplied so OOG probes actually constrain the budget.
          fee_limit:
            overrides.feeLimit !== null && overrides.feeLimit !== undefined
              ? Number(overrides.feeLimit)
              : 1_000_000_000,
          call_value: callValueSun,
          visible: false,
        }),
      },
    );
    if (
      !triggerJson.transaction ||
      !triggerJson.result ||
      triggerJson.result.code
    ) {
      throw new Error(
        `triggersmartcontract failed (impersonated from ${fromTronBase58}): ` +
          JSON.stringify(triggerJson),
      );
    }

    // TronWeb's `trx.sign` verifies that the private key derives to
    // the unsigned tx's `owner_address` and throws "Private key does
    // not match address in transaction" otherwise. For an impersonated
    // call the owner IS the address we don't hold a key for — that's
    // the whole point. Passing `multisig: true` (4th arg) bypasses
    // the owner-key check while keeping the signing primitive intact.
    // The signature ECRecovers to the deployer; the patched
    // `TransactionCapsule.validateSignature` accepts that because
    // owner is on `TreImpersonationRegistry`.
    const signed = await deployerTronWeb.trx.sign(
      triggerJson.transaction,
      undefined,
      undefined,
      true,
    );
    const broadcastJson = await requestJson(
      deployerTronWeb,
      '/wallet/broadcasttransaction',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      },
    );
    if (!broadcastJson.result) {
      const code =
        broadcastJson.code ||
        broadcastJson.message ||
        JSON.stringify(broadcastJson);
      const hint = /SIGERROR|signature/i.test(String(code))
        ? ' (impersonation requires the patched TransactionCapsule)'
        : '';
      throw new Error(`impersonated broadcast failed: ${code}${hint}`);
    }
    return signed.txID || broadcastJson.txid;
  }

  async function buildRevertErrorWithSim(
    txId,
    info,
    fnAbi,
    tronContract,
    tronWeb,
    normalized,
    overrides,
  ) {
    const err = buildRevertError(txId, info);
    if (err.data && err.data !== '0x') {
      return err;
    }
    let simErr;
    try {
      await staticCallWithRevertData(
        fnAbi,
        tronContract,
        tronWeb,
        normalized,
        overrides,
      );
    } catch (e) {
      simErr = e;
    }
    if (simErr && typeof simErr.data === 'string' && simErr.data !== '0x') {
      err.data = simErr.data;
      if (simErr.reason) {
        err.reason = simErr.reason;
      }
      return err;
    }
    return err;
  }

  function makeMethod(fnAbi, tronContract, tronWeb, hre) {
    const isView =
      fnAbi.stateMutability === 'view' || fnAbi.stateMutability === 'pure';

    async function prepareCall(rawArgs) {
      const { overrides, args } = splitOverrides(rawArgs, fnAbi.inputs.length);
      const effective = {
        value: valueToCallValue(overrides.value ?? 0),
        gasLimit: overrides.gasLimit,
      };
      const normalized = await normalizeCallArguments(fnAbi.inputs, args);
      return { overrides: effective, normalized };
    }

    async function invoke(...rawArgs) {
      const { overrides, normalized } = await prepareCall(rawArgs);
      if (!isView && !tronWeb.defaultPrivateKey) {
        throw new Error(
          'TRON state changes require a configured local signing account',
        );
      }
      if (isView) {
        return staticCallWithRevertData(
          fnAbi,
          tronContract,
          tronWeb,
          normalized,
          overrides,
        );
      }
      // Honor `overrides.gasLimit` by mapping to TVM's `feeLimit` via
      // TRE's energy price (~100 sun/energy — see the feeLimit comment
      // below). Without this, a test passing `{gasLimit: 100_000}` to
      // force an OOG sub-call path silently ran with the full 1B-sun
      // budget and the constrained-gas scenario was never exercised
      // (e.g. test/governance/TimelockController.test.js's
      // mockFunctionOutOfGas case, test/utils/Address.test.js's
      // $functionCall(..., {gasLimit: 120_000n}) case).
      const _gasLimitSun =
        overrides.gasLimit !== null && overrides.gasLimit !== undefined
          ? Math.max(
              1,
              Math.min(1_000_000_000, Number(BigInt(overrides.gasLimit)) * 100),
            )
          : 1_000_000_000;
      // Impersonated write: route through the raw HTTP path with a
      // forged `owner_address`. `_impersonatedFrom` is set by
      // `makeImpersonatingSigner`; for normal signers it's undefined
      // and we keep the TronWeb-contract `.send()` happy path.
      if (tronWeb._impersonatedFrom) {
        const deployerTronWeb = hre.tre.makeTronWeb().tronWeb;
        const txId = await sendImpersonatedCall(
          fnAbi,
          tronContract.address,
          tronWeb._impersonatedFrom,
          normalized,
          deployerTronWeb,
          { ...overrides, feeLimit: _gasLimitSun },
        );
        const info = await hre.tre.waitForReceipt(deployerTronWeb, txId);
        if (!(info && info.receipt && info.receipt.result === 'SUCCESS')) {
          throw await buildRevertErrorWithSim(
            txId,
            info,
            fnAbi,
            tronContract,
            tronWeb,
            normalized,
            overrides,
          );
        }
        // Outer-call value for chai-matchers' ether-balance accounting.
        const impCallValueSun =
          overrides.value !== null && overrides.value !== undefined
            ? valueToCallValue(overrides.value)
            : 0;
        return makeTxResponse(txId, info, tronContract._iface || null, {
          fromBase58: tronWeb._impersonatedFrom,
          toBase58: tronContract.address,
          callValueSun: impCallValueSun,
        });
      }
      // feeLimit caps the energy a single tx can buy. TRE's hard
      // ceiling is 1_000_000_000 sun (1000 TRX) — TronWeb's validator
      // rejects anything higher with "feeLimit must be >= 0 and <=
      // 1000000000". At TRE's energy price of ~100 sun/energy, that
      // converts to a 10M-energy budget, which matches the
      // `originEnergyLimit` cap. We set the max here so heavier calls
      // (e.g. Create2 deploy of full VestingWallet bytecode) get the
      // full budget. Tests that still exhaust 10M surface a real TVM
      // ceiling — see test 4 in Create2.test.js.
      const sendOpts = { feeLimit: _gasLimitSun };
      if (overrides.value !== null && overrides.value !== undefined) {
        // 1 wei == 1 sun pass-through (cheatcodes.js top-of-file).
        // TronWeb's contract proxy expects `callValue` in sun. It also
        // JSON.stringify's the params internally, so BigInts need to be
        // converted to strings (Java parses Long natively from quoted
        // ints in this field). Number coercion would lose precision
        // above 2^53 sun.
        const cv = valueToCallValue(overrides.value);
        sendOpts.callValue = typeof cv === 'bigint' ? cv.toString() : cv;
      }

      // TronWeb's contract proxy can't encode tuple-typed args reliably
      // — its bundled ethers AbiCoder chokes on the struct object even
      // when nested addresses are hex-formatted, throwing "cannot
      // encode object for signature with missing names". Workaround:
      // ethers-encode the calldata ourselves and broadcast through the
      // same raw HTTP path the impersonation case uses. `multisig:
      // false` keeps TronWeb's owner-key check active — the current
      // signer's TronWeb HAS the matching private key, so it signs
      // normally.
      const hasTupleInput = fnAbi.inputs.some(
        (i) => i && (i.type === 'tuple' || /^tuple\[/.test(i.type)),
      );
      if (hasTupleInput) {
        const { fragment: ifaceFragment, iface } = getFragmentAndIface(fnAbi);
        const calldata = iface.encodeFunctionData(ifaceFragment, normalized);
        const fromBase58 =
          tronWeb.defaultAddress && tronWeb.defaultAddress.base58;
        const txId = await sendCallTx(tronWeb, {
          fromBase58,
          toBase58: tronContract.address,
          data: calldata,
          value:
            overrides.value !== null && overrides.value !== undefined
              ? overrides.value
              : 0n,
          multisig: false,
          feeLimit: _gasLimitSun,
        });
        const info = await hre.tre.waitForReceipt(tronWeb, txId);
        if (!(info && info.receipt && info.receipt.result === 'SUCCESS')) {
          throw await buildRevertErrorWithSim(
            txId,
            info,
            fnAbi,
            tronContract,
            tronWeb,
            normalized,
            overrides,
          );
        }
        return makeTxResponse(txId, info, tronContract._iface || null, {
          fromBase58,
          toBase58: tronContract.address,
          callValueSun: sendOpts.callValue || 0,
        });
      }

      let txId;
      try {
        txId = await tronContract[fnAbi.name](...normalized).send(sendOpts);
      } catch (sendErr) {
        // TronWeb may reject before returning a transaction hash. Keep
        // supplied revert bytes; otherwise a constant call can provide
        // diagnostic bytes while retaining the original error as its cause.
        if (
          sendErr &&
          typeof sendErr.data === 'string' &&
          sendErr.data !== '0x'
        ) {
          throw sendErr;
        }
        const msg =
          sendErr && sendErr.message
            ? String(sendErr.message)
            : String(sendErr);
        if (/Not enough energy|OUT_OF_ENERGY|REVERT/.test(msg)) {
          let simErr;
          try {
            await staticCallWithRevertData(
              fnAbi,
              tronContract,
              tronWeb,
              normalized,
              overrides,
            );
          } catch (e) {
            simErr = e;
          }
          if (
            simErr &&
            typeof simErr.data === 'string' &&
            simErr.data !== '0x'
          ) {
            simErr.cause = sendErr;
            throw simErr;
          }
          // Empty or failed diagnostic calls cannot replace the send error.
        }
        throw sendErr;
      }
      const info = await hre.tre.waitForReceipt(tronWeb, txId);
      if (!(info && info.receipt && info.receipt.result === 'SUCCESS')) {
        throw await buildRevertErrorWithSim(
          txId,
          info,
          fnAbi,
          tronContract,
          tronWeb,
          normalized,
          overrides,
        );
      }
      return makeTxResponse(txId, info, tronContract._iface || null, {
        fromBase58: tronWeb.defaultAddress && tronWeb.defaultAddress.base58,
        toBase58: tronContract.address,
        callValueSun: sendOpts.callValue || 0,
      });
    }

    invoke.estimateGas = async (...rawArgs) => {
      const { normalized, overrides } = await prepareCall(rawArgs);
      await staticCallWithRevertData(
        fnAbi,
        tronContract,
        tronWeb,
        normalized,
        overrides,
      );
      return isView ? 21000n : 50000n;
    };

    invoke.staticCall = async (...rawArgs) => {
      const { normalized, overrides } = await prepareCall(rawArgs);
      return staticCallWithRevertData(
        fnAbi,
        tronContract,
        tronWeb,
        normalized,
        overrides,
      );
    };
    invoke.fragment = getFragmentAndIface(fnAbi).fragment;
    // ethers v6 contract methods expose `.getFragment(...args)` for
    // overload resolution. Used by upstream OZ tests via
    // `this.target.fnRestricted.getFragment().selector` to grab the
    // 4-byte selector without re-encoding. We return the same ABI
    // descriptor we hand back via `.fragment`, wrapped in
    // ethers.FunctionFragment so `.selector` / `.format()` work.
    invoke.getFragment = () => getFragmentAndIface(fnAbi).fragment;
    return invoke;
  }

  function makeTxResponse(txId, info, iface = null, meta = {}) {
    const receipt = translateReceipt(txId, info, iface);
    rememberReceipt('0x' + txId, receipt);
    // Outer-call metadata so the TVM-aware chai matchers (plugin/
    // chai-matchers-tvm.js) can account for the user→contract value
    // flow alongside receipt.internalTransactions. `meta.fromBase58`,
    // `meta.toBase58`, and `meta.callValueSun` are passed by
    // makeMethod/invoke; we project them onto the ethers-shaped
    // `{from, to, valueSun}` properties.
    const from = meta.fromBase58 ? tronToHex(meta.fromBase58) : undefined;
    const to = meta.toBase58 ? tronToHex(meta.toBase58) : undefined;
    const valueSun =
      meta.callValueSun !== null && meta.callValueSun !== undefined
        ? valueToCallValue(meta.callValueSun)
        : 0n;
    return deps.context.registerSubject({
      hash: '0x' + txId,
      transactionHash: '0x' + txId,
      txId,
      blockNumber: info ? info.blockNumber : undefined,
      from,
      to,
      valueSun,
      feeSun: receipt.feeSun,
      internalTransactions: receipt.internalTransactions,
      logs: receipt.logs,
      wait: async () => receipt,
    });
  }

  // -- Contract facade -----------------------------------------------

  // `tronWeb` here is the signer's TronWeb (its bytecode signs txs).
  // For read-only paths the deployer's TronWeb works just as well, but
  // `factory.connect(signer)` rebuilds the facade with the SIGNER's
  // TronWeb so writes are signed by them.
  function makeFacade(abi, tronAddress, tronWeb, hre, deploymentTx = null) {
    // Index exact signatures and selectors. Bare overloaded names delegate
    // argument and Typed disambiguation to the installed ethers Interface.
    const overloadsByName = new Map();
    const fnsBySignature = new Map();
    // Selector → ABI function. OZ tests use
    // `target.connect(signer)[selector]()` (where `selector` is a
    // 4-byte hex string like `'0xabcd1234'`) to call functions by
    // selector without re-encoding. Index up front so the Proxy's
    // string-key fallthrough can find the match.
    const fnsBySelector = new Map();
    for (const item of abi) {
      if (item.type !== 'function') {
        continue;
      }
      const sig = canonicalSig(item);
      fnsBySignature.set(sig, item);
      if (!overloadsByName.has(item.name)) {
        overloadsByName.set(item.name, []);
      }
      overloadsByName.get(item.name).push(item);
      const selector =
        ethersV6.FunctionFragment.from(item).selector.toLowerCase();
      fnsBySelector.set(selector, item);
    }

    const tronContract = tronWeb.contract(abi, tronAddress);
    const ethersInterface = new ethersV6.Interface(abi);
    // Stash the iface on the TronWeb contract so makeMethod can pull
    // it into translateReceipt without re-allocating per call.
    tronContract._iface = ethersInterface;

    // Look up an ABI function by signature, accepting either the
    // canonical form (`$slice(address[],uint256)`) or the named-parameter
    // form (`$slice(address[] arr, uint256 start)`). Upstream OZ tests
    // (Arrays.test.js et al.) use the named form to dispatch through
    // `this.mock[fragment](...)` — without this, the Proxy returns
    // undefined and the test fails with "is not a function". We parse
    // via ethers.FunctionFragment so param-name handling matches what
    // ethers v6's own `Interface.getFunction` does.
    function lookupBySignature(prop) {
      const direct = fnsBySignature.get(prop);
      if (direct) {
        return direct;
      }
      try {
        const frag = ethersV6.FunctionFragment.from(prop);
        const canonical = frag.format('sighash');
        return fnsBySignature.get(canonical) || null;
      } catch {
        return null;
      }
    }

    // Build a method handle for a SPECIFIC ABI entry. For overloaded
    // names TronWeb's contract proxy can't disambiguate by signature —
    // it picks one entry under the shared name and the encoder errors
    // with "too many arguments" on the others (seen in
    // test/token/ERC20/extensions/ERC1363.test.js via
    // `getFunction('transferAndCall(address,uint256,bytes)')(...)`).
    // For overloaded names, build a single-function TronWeb contract
    // so TronWeb sees exactly the right entry. Single-entry names
    // reuse the shared `tronContract` to avoid per-method allocations.
    //
    // Both the single-fn TronWeb contracts AND the resulting method
    // handles are cached per facade. Without this, every property
    // access through the Proxy's `get` trap allocated a fresh
    // single-fn contract + fresh `invoke`/`staticCall`/`estimateGas`
    // closures, even when the same `contract.balanceOf` was looked
    // up dozens of times in a loop. The cache lives in this closure
    // so it's GC'd with the facade.
    const _singleContractCache = new Map(); // canonicalSig → single TronWeb contract
    const _methodHandleCache = new Map(); // canonicalSig → invoke fn
    function methodFor(fn) {
      const sig = canonicalSig(fn);
      const cachedHandle = _methodHandleCache.get(sig);
      if (cachedHandle) {
        return cachedHandle;
      }
      const overloads = overloadsByName.get(fn.name);
      let contractForCall;
      if (overloads && overloads.length > 1) {
        let single = _singleContractCache.get(sig);
        if (!single) {
          single = tronWeb.contract([fn], tronAddress);
          single._iface = ethersInterface;
          _singleContractCache.set(sig, single);
        }
        contractForCall = single;
      } else {
        contractForCall = tronContract;
      }
      const handle = makeMethod(fn, contractForCall, tronWeb, hre);
      _methodHandleCache.set(sig, handle);
      return handle;
    }
    // Checksummed (EIP-55) for ethers-style assertions like
    // `ethers.getCreate2Address(factory.target, ...)` which ethers also
    // returns in checksummed form.
    const hexAddress = ethersV6.getAddress(tronToHex(tronAddress));

    const target = {
      target: hexAddress,
      address: hexAddress,
      tronAddress,
      interface: ethersInterface,
      abi,
      // Runner mirrors ethers v6's `BoundContract.runner` — it's the
      // signer-shaped object that subsequent `.connect(...)` calls
      // accept. Carrying the closure's `tronWeb` here lets chained
      // patterns work: `token.connect(governor.runner).transfer(...)`
      // (used by test/helpers/governance.js's `delegate` to send the
      // token transfer from whoever the governor was connected to).
      // Without `tronWeb` on the runner, those connects fall back to
      // the deployer key and the transfer reverts with
      // ERC20InsufficientBalance(deployer, 0, expected) — see Governor
      // Storage / TimelockControl fixtures.
      runner: { provider: stubProvider, tronWeb },
      provider: stubProvider,
    };

    return deps.context.registerSubject(
      new Proxy(target, {
        get(t, prop, receiver) {
          if (prop in t) {
            return t[prop];
          }
          if (prop === 'getAddress') {
            return async () => hexAddress;
          }
          if (prop === 'getFunction') {
            // ethers v6 API: contract.getFunction('name(type,type)') returns
            // a method handle for an exact-signature lookup. Used by tests
            // that disambiguate overloads explicitly. For bare names with
            // multiple overloads, return the same arg-shape dispatcher the
            // `contract.name(...)` proxy path uses — ethers v6 lets you
            // call `getFunction('name')(...args)` and resolves the overload
            // at call time via `ethers.Typed.X(...)` wrappers, identical to
            // accessing the method directly. SignatureChecker.test.js's
            // ERC1271/ERC7913 cases exercise this:
            //   `mock.getFunction('$isValidSignatureNow')(Typed.address(...), ...)`
            // and
            //   `mock.getFunction('$isValidSignatureNow')(Typed.bytes(...), ...)`
            // both target the same name but different `bytes`/`address` first
            // argument types.
            return (signature) => {
              if (typeof signature === 'string' && signature.includes('(')) {
                const fn = lookupBySignature(signature);
                if (fn) {
                  return methodFor(fn);
                }
              }
              const overloads = overloadsByName.get(signature);
              if (overloads && overloads.length === 1) {
                return methodFor(overloads[0]);
              }
              if (overloads && overloads.length > 1) {
                return makeOverloadDispatcher(
                  overloads,
                  tronAddress,
                  tronWeb,
                  hre,
                  ethersInterface,
                );
              }
              throw new Error(`getFunction: no match for "${signature}"`);
            };
          }
          if (prop === 'connect') {
            // contract.connect(signer) → rebuild the facade routed
            // through the signer's TronWeb so subsequent state-changing
            // calls are signed by that signer's key.
            return (signer) => {
              validateNativeSigner(signer, false);
              return makeFacade(abi, tronAddress, signer.tronWeb, hre);
            };
          }
          if (prop === 'attach') {
            return (addr) => makeFacade(abi, toTronBase58(addr), tronWeb, hre);
          }
          if (prop === 'waitForDeployment') {
            return async () => receiver;
          }
          if (prop === 'deploymentTransaction') {
            // chai-matchers' `.to.emit(contract, ...)` against a
            // `contract.deploymentTransaction()` destructures `{hash}`
            // and awaits `.wait()` to scan logs for the expected event.
            // Synthesize a TransactionResponse from the deploy receipt
            // when we have one; null is only acceptable when nothing
            // was deployed (e.g. an `attach`).
            return () => deploymentTx || null;
          }
          if (prop === 'then' || typeof prop === 'symbol') {
            return undefined;
          }

          // Selector lookup: `contract[selector]()` where selector is a
          // 4-byte hex string. Used by upstream OZ tests that grab the
          // selector via `fnRestricted.getFragment().selector` and call
          // by that without re-binding to the function name.
          if (typeof prop === 'string' && /^0x[0-9a-fA-F]{8}$/.test(prop)) {
            const fn = fnsBySelector.get(prop.toLowerCase());
            if (fn) {
              return methodFor(fn);
            }
          }

          // Match on full signature first (for explicit disambiguation),
          // then resolve bare names with ethers argument and Typed rules.
          // `lookupBySignature` accepts both the canonical form
          // `name(type,type)` and the named-parameter form
          // `name(type name1, type name2)` — Arrays.test.js dispatches
          // through `this.mock['$slice(address[] arr, uint256 start)']`.
          if (typeof prop === 'string' && prop.includes('(')) {
            const fn = lookupBySignature(prop);
            if (fn) {
              return methodFor(fn);
            }
          }
          const overloads = overloadsByName.get(prop);
          if (!overloads || overloads.length === 0) {
            return undefined;
          }
          if (overloads.length === 1) {
            return methodFor(overloads[0]);
          }
          // Resolve at invocation time so ambiguity remains an error.
          return makeOverloadDispatcher(
            overloads,
            tronAddress,
            tronWeb,
            hre,
            ethersInterface,
          );
        },
      }),
    );
  }

  function makeOverloadDispatcher(
    overloads,
    tronAddress,
    tronWeb,
    hre,
    ethersInterface,
  ) {
    // TronWeb's `contract(abi, addr)` proxy can't disambiguate
    // overloaded function names — `contract.method` returns one entry
    // (typically the first registered), and calling with a different
    // arg count fails inside its ABI encoder ("invalid address" /
    // "invalid bytes" / etc on whatever the missing arg's type is).
    //
    // Sidestep that by building a single-function TronWeb contract per
    // overload: TronWeb sees exactly one entry under this name, so it
    // can't pick the wrong one. The single-fn contract + method handle
    // are cached per (dispatcher, signature) so repeat calls into the
    // same overload don't reallocate. Cache scope is this closure so
    // it's GC'd with the dispatcher (one dispatcher per facade per
    // overloaded name).
    const _dispatchSingleCache = new Map();
    const _dispatchHandleCache = new Map();
    function handleFor(fn) {
      const sig = canonicalSig(fn);
      const cached = _dispatchHandleCache.get(sig);
      if (cached) {
        return cached;
      }
      let single = _dispatchSingleCache.get(sig);
      if (!single) {
        single = tronWeb.contract([fn], tronAddress);
        if (ethersInterface) {
          single._iface = ethersInterface;
        }
        _dispatchSingleCache.set(sig, single);
      }
      const handle = makeMethod(fn, single, tronWeb, hre);
      _dispatchHandleCache.set(sig, handle);
      return handle;
    }

    function pickOverload(rawArgs) {
      const fragment = ethersInterface.getFunction(overloads[0].name, rawArgs);
      if (!fragment) {
        throw new Error(`No matching overload for ${overloads[0].name}`);
      }
      return overloads.find(
        (entry) => canonicalSig(entry) === fragment.format('sighash'),
      );
    }

    async function invoke(...args) {
      const match = pickOverload(args);
      return handleFor(match)(...args);
    }
    invoke.staticCall = async (...args) => {
      const match = pickOverload(args);
      return handleFor(match).staticCall(...args);
    };
    invoke.estimateGas = async (...args) =>
      handleFor(pickOverload(args)).estimateGas(...args);
    invoke.getFragment = (...args) =>
      ethersInterface.getFunction(overloads[0].name, args);
    return invoke;
  }

  // -- Artifact loader ------------------------------------------------

  async function loadArtifact(hre, name) {
    let artifact;
    if (hre.artifacts) {
      artifact = await hre.artifacts.readArtifact(name);
    } else {
      const root = hre.config.paths.artifacts;
      const separator = name.lastIndexOf(':');
      let filename;
      if (separator !== -1) {
        filename = path.join(
          root,
          name.slice(0, separator),
          `${name.slice(separator + 1)}.json`,
        );
      } else {
        // Standalone consumers have no host manager. Scan every source root,
        // including dependencies, while excluding build metadata.
        const candidates = fs.existsSync(root)
          ? fs
              .readdirSync(root, { recursive: true, withFileTypes: true })
              .filter(
                (entry) =>
                  entry.isFile() &&
                  entry.name === `${name}.json` &&
                  !entry.name.endsWith('.dbg.json'),
              )
              .map((entry) => path.join(entry.parentPath, entry.name))
              .filter((file) => {
                const relative = path.relative(root, file);
                return (
                  relative.includes(path.sep) &&
                  relative.split(path.sep)[0] !== 'build-info'
                );
              })
          : [];
        if (candidates.length === 0) {
          throw new Error(
            `Artifact for contract "${name}" not found in ${root}`,
          );
        }
        if (candidates.length > 1) {
          throw new Error(`Multiple artifacts named "${name}" found; use a fully-qualified name:
  ${candidates.join('\n  ')}`);
        }
        filename = candidates[0];
      }
      const source = fs.readFileSync(filename, 'utf8');
      try {
        artifact = JSON.parse(source);
      } catch (error) {
        throw new Error(`Invalid JSON in contract artifact ${filename}`, {
          cause: error,
        });
      }
    }
    if (
      artifact === null ||
      typeof artifact !== 'object' ||
      Array.isArray(artifact) ||
      !Array.isArray(artifact.abi) ||
      typeof artifact.bytecode !== 'string' ||
      (artifact.sourceName !== undefined &&
        typeof artifact.sourceName !== 'string') ||
      (artifact.contractName !== undefined &&
        typeof artifact.contractName !== 'string')
    ) {
      throw new Error(`Invalid contract artifact: ${name}`);
    }
    return artifact;
  }

  // -- Predict-address cache ---------------------------------------
  //
  // TVM derives a CREATE'd contract's address as
  // `0x41 || keccak256(txID || ownerAddress)[12:]`. The txID depends on
  // the full raw_data (selector + args + ref_block_* + expiration +
  // timestamp), so it cannot be computed from `nonce` alone the way the
  // EVM formula does. Upstream OZ tests pre-compute the address via
  // `ethers.getCreateAddress({from, nonce})` — broken on TVM in two
  // places (wrong formula AND `getNonce()` is meaningless).
  //
  // The fix: `signer.predictAddress(name, args)` on the bridge's
  // signer object builds + signs a CreateSmartContract tx via
  // TronWeb (which populates `tx.contract_address` locally before
  // broadcast — see node_modules/tronweb/lib/esm/lib/TransactionBuilder/
  // helper.js:37-43). The pre-signed tx is stashed here keyed by
  // `(deployer, artifact, encoded constructor, effective overrides)`; the next
  // `ethers.deployContract(name, args, signer)` call with matching key
  // pops the cache and broadcasts the pre-signed tx byte-for-byte, so
  // the deployed address matches the prediction.
  //
  // Cache lifetime: each cache hit consumes the entry (one prediction →
  // one broadcast). Stale entries that are never consumed leak memory
  // of the order of one signed tx per stale predict, which is
  // negligible for the test suite.
  const _prebuildCache = new Map();

  async function prepareDeployment(deployerAddress, artifact, args) {
    const iface = new ethersV6.Interface(artifact.abi);
    const inputs = iface.deploy.inputs;
    const { overrides, args: constructorArgs } = splitOverrides(
      args,
      inputs.length,
    );
    const ctorArgs = constructorArgs;
    if (ctorArgs.length !== inputs.length) {
      throw new Error(
        `${artifact.contractName || 'Contract'} constructor expects ${inputs.length} argument(s), received ${ctorArgs.length}`,
      );
    }

    // Capture effective overrides before any asynchronous work. Both the
    // cache identity and the transaction builder consume these values.
    const callValue = valueToCallValue(overrides.value ?? 0);
    const deployOpts = {
      callValue:
        typeof callValue === 'bigint' ? callValue.toString() : callValue,
      feeLimit:
        overrides.gasLimit === null || overrides.gasLimit === undefined
          ? 1_000_000_000
          : Math.max(
              1,
              Math.min(1_000_000_000, Number(BigInt(overrides.gasLimit)) * 100),
            ),
    };
    const parameters = await normalizeArguments(inputs, ctorArgs);
    deployOpts.rawParameter = iface.encodeDeploy(parameters);
    const cacheKey = JSON.stringify({
      deployer: tronToHex(deployerAddress),
      sourceName: artifact.sourceName ?? null,
      name: artifact.contractName ?? 'Contract',
      abi: iface.formatJson(),
      bytecode: ethersV6.hexlify(artifact.bytecode),
      parameters: deployOpts.rawParameter,
      callValue: String(deployOpts.callValue),
      feeLimit: deployOpts.feeLimit,
    });
    return { cacheKey, deployOpts };
  }

  // -- Deploy -------------------------------------------------------

  async function deployViaFacade(
    hre,
    name,
    args = [],
    signer = null,
    selectedArtifact,
  ) {
    // If a signer is provided, deploy through THAT signer's TronWeb -
    // contract ownership / msg.sender at construction reflects the
    // signer's TVM address. Without a signer, fall back to the
    // default deployer key from hardhat.config.cjs.
    const tronWeb =
      signer && signer.tronWeb ? signer.tronWeb : hre.tre.makeTronWeb().tronWeb;
    const deployerAddress =
      signer && signer.tronAddress
        ? signer.tronAddress
        : tronWeb.defaultAddress.base58;
    if (!tronWeb.defaultPrivateKey) {
      throw new Error(
        'TRON deployment requires a configured local signing account',
      );
    }
    const artifact = selectedArtifact ?? (await loadArtifact(hre, name));
    const { cacheKey, deployOpts } = await prepareDeployment(
      deployerAddress,
      artifact,
      args,
    );

    // Predict-address shortcut: if a prior `signer.predictAddress(name,
    // args)` call stashed a pre-signed tx for the same account, artifact,
    // constructor bytes and effective overrides, broadcast it directly.
    // Skipping the createSmartContract rebuild guarantees the deployed
    // address equals the earlier prediction, since the unsigned raw_data
    // (and therefore the txID
    // that feeds into the CREATE formula) is byte-identical.
    const cached = _prebuildCache.get(cacheKey);
    if (cached) {
      _prebuildCache.delete(cacheKey);
      const { address, txId, info } = await hre.tre.submitPrebuilt(
        tronWeb,
        cached.signedTx,
      );
      const iface = new ethersV6.Interface(artifact.abi);
      const deployReceipt = translateReceipt(txId, info, iface);
      rememberReceipt('0x' + txId, deployReceipt);
      const deploymentTx = deps.context.registerSubject({
        hash: '0x' + txId,
        transactionHash: '0x' + txId,
        blockNumber: info ? info.blockNumber : undefined,
        logs: deployReceipt.logs,
        wait: async () => deployReceipt,
      });
      return makeFacade(artifact.abi, address, tronWeb, hre, deploymentTx);
    }

    const { address, txId, info } = await hre.tre.deployContract(
      tronWeb,
      deployerAddress,
      artifact,
      deployOpts,
    );

    // Build a TransactionResponse for `contract.deploymentTransaction()`.
    // `translateReceipt` decodes logs against the deployed contract's
    // ABI so events emitted from the constructor (`AuthorityUpdated`,
    // `Initialized`, …) are visible to chai-matchers' `.to.emit`.
    const iface = new ethersV6.Interface(artifact.abi);
    const deployReceipt = translateReceipt(txId, info, iface);
    rememberReceipt('0x' + txId, deployReceipt);
    const deploymentTx = deps.context.registerSubject({
      hash: '0x' + txId,
      transactionHash: '0x' + txId,
      blockNumber: info ? info.blockNumber : undefined,
      logs: deployReceipt.logs,
      wait: async () => deployReceipt,
    });

    return makeFacade(artifact.abi, address, tronWeb, hre, deploymentTx);
  }

  // -- Factory ------------------------------------------------------

  function validateNativeSigner(signer, allowDefault = true) {
    if (allowDefault && (signer === null || signer === undefined)) {
      return;
    }
    if (
      typeof signer !== 'object' ||
      signer === null ||
      signer.tronWeb === null ||
      typeof signer.tronWeb !== 'object'
    ) {
      throw new Error('Contract operations require a native TRON signer');
    }
  }

  function makeFactory(hre, name, artifact, boundSigner = null) {
    validateNativeSigner(boundSigner);
    const iface = new ethersV6.Interface(artifact.abi);
    return {
      bytecode: artifact.bytecode,
      interface: iface,
      abi: artifact.abi,
      deploy: async (...args) =>
        deployViaFacade(hre, name, args, boundSigner, artifact),
      // factory.connect(signer) returns a new factory whose .deploy
      // routes through the signer's TronWeb. Upstream OZ tests use this
      // to "deploy as alice" patterns.
      connect: (signer) => {
        validateNativeSigner(signer, false);
        return makeFactory(hre, name, artifact, signer);
      },
      attach: (addr) => {
        const tronWeb =
          boundSigner && boundSigner.tronWeb
            ? boundSigner.tronWeb
            : hre.tre.makeTronWeb().tronWeb;
        return makeFacade(artifact.abi, toTronBase58(addr), tronWeb, hre);
      },
      // ethers v6 occasionally probes `getDeployTransaction` to encode
      // constructor args. We synthesize a minimal shape — `data` is the
      // bytecode + abi-encoded args, which is what tests inspect.
      getDeployTransaction: (...args) => {
        const ctor = artifact.abi.find((a) => a.type === 'constructor');
        const encoded = ctor ? iface.encodeDeploy(args) : '0x';
        return { data: ethersV6.concat([artifact.bytecode, encoded]) };
      },
    };
  }

  // -- Signers -------------------------------------------------------

  // Materialize (or return cached) the bridge's signer set. Hands the
  // signers module the bridge-side deps it needs to integrate cleanly:
  // the receipts cache so `signer.sendTransaction` results are
  // resolvable by `provider.getTransactionReceipt`, and the receipt
  // poller so the call path can wait for confirmation.
  async function makeSigners(hre) {
    const signers = await signersMod.buildSigners(hre, {
      knownReceipts,
      waitForReceipt: hre.tre.waitForReceipt,
    });
    // Attach the stub provider for `signer.provider` access (some chai
    // matchers reach into it).
    return signers.map((s) => Object.assign(s, { provider: stubProvider }));
  }

  // Pseudo-signer for an impersonated address. Carries the deployer's
  // TronWeb (we don't have the impersonated key) tagged with
  // `_impersonatedFrom` so `makeMethod` routes writes through the
  // raw-HTTP path with a forged `owner_address`. Compatible with
  // `contract.connect(signer)` and the `getSigner(address)` flow.
  //
  // `signMessage` / `signTypedData` are deliberately omitted —
  // impersonation is for `msg.sender`-driven flows, not off-chain
  // signature flows.
  function makeImpersonatingSigner(hre, address) {
    const base58 = signersMod.toBase58(address);
    const hex21 = TronWeb.address.toHex(base58);
    const checksum = ethersV6.getAddress('0x' + hex21.slice(2));
    const deployerTronWeb = hre.tre.makeTronWeb().tronWeb;
    if (!deployerTronWeb.defaultPrivateKey) {
      throw new Error(
        'TRON impersonation requires a configured local signing account',
      );
    }
    // Prototype-clone the deployer's TronWeb so all methods and state
    // (defaultAddress, privateKey, fullNode) are inherited unchanged
    // and only the impersonation tag lives on our local object.
    // Mutating `_impersonatedFrom` directly on the deployer instance
    // would leak across signers.
    const tronWeb = Object.create(deployerTronWeb);
    tronWeb._impersonatedFrom = base58;

    const signer = {
      address: checksum,
      tronAddress: base58,
      tronWeb,
      provider: stubProvider,
      _impersonated: true,
      getAddress: async () => checksum,
      connect() {
        return signer;
      },
      async sendTransaction({ to, data, value } = {}) {
        const toBase58 = signersMod.toBase58(to);
        // Any `data` field (including '0x') → TriggerSmartContract;
        // `data === undefined` → plain TRX transfer. `multisig: true`
        // bypasses TronWeb's owner-key check; the patched fork accepts
        // the forged owner via the impersonation registry bypass.
        const hasDataField = typeof data === 'string';
        let txId;
        if (hasDataField) {
          txId = await sendCallTx(deployerTronWeb, {
            fromBase58: base58,
            toBase58,
            data,
            value,
            multisig: true,
          });
        } else {
          txId = await sendTransferTx(deployerTronWeb, {
            fromBase58: base58,
            toBase58,
            value,
            multisig: true,
          });
        }
        const info = await hre.tre.waitForReceipt(deployerTronWeb, txId, {
          executionReceipt: hasDataField,
        });
        const succeeded = hasDataField
          ? info && info.receipt && info.receipt.result === 'SUCCESS'
          : info.result !== 'FAILED';
        const callValueSun = valueToCallValue(value);
        const energyFee =
          info && info.receipt && Number.isFinite(info.receipt.energy_fee)
            ? Number(info.receipt.energy_fee)
            : 0;
        const netFee =
          info && info.receipt && Number.isFinite(info.receipt.net_fee)
            ? Number(info.receipt.net_fee)
            : 0;
        const totalFeeSun = (info && info.fee) || energyFee + netFee;
        const receipt = {
          nativeTransactionId: txId,
          nativeReceipt: info?.receipt,
          nativeTransactionInfo: info,
          hash: '0x' + txId,
          transactionHash: '0x' + txId,
          status: succeeded ? 1 : 0,
          blockNumber: info ? info.blockNumber : undefined,
          logs: [],
          feeSun: totalFeeSun,
          internalTransactions: (info && info.internal_transactions) || [],
        };
        rememberReceipt(receipt.hash, receipt);
        if (hasDataField && !receipt.status) {
          throw buildRevertError(txId, info);
        }
        return deps.context.registerSubject({
          hash: receipt.hash,
          transactionHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          from: tronToHex(base58),
          to: tronToHex(toBase58),
          valueSun: callValueSun,
          feeSun: totalFeeSun,
          internalTransactions: receipt.internalTransactions,
          wait: async () => receipt,
        });
      },
    };
    return deps.context.registerSubject(signer);
  }

  // -- Snapshot + loadFixture --------------------------------------

  // `SnapshotRestorer` — analogue of `hardhat-network-helpers`'
  // `SnapshotRestorer`. `restore()` reverts to the snapshot AND
  // immediately re-snapshots so the restorer stays reusable; the
  // public `snapshotId` is the live id (used for the chronological
  // comparison in `loadFixture`).
  function _makeRestorer(tronWeb, initialId) {
    let snapshotId = initialId;
    return {
      get snapshotId() {
        return snapshotId;
      },
      async restore() {
        const rev = await rpcCall(tronWeb, 'tre_revert', [snapshotId]);
        if (rev.error || rev.result !== true) {
          throw new Error(`tre_revert failed: ${JSON.stringify(rev.error)}`);
        }
        const snap = await rpcCall(tronWeb, 'tre_snapshot', []);
        if (snap.error) {
          throw new Error(`tre_snapshot failed: ${JSON.stringify(snap.error)}`);
        }
        snapshotId = snap.result;
      },
    };
  }

  async function _takeSnapshot(tronWeb) {
    const snap = await rpcCall(tronWeb, 'tre_snapshot', []);
    if (snap.error) {
      throw new Error(`tre_snapshot failed: ${JSON.stringify(snap.error)}`);
    }
    return _makeRestorer(tronWeb, snap.result);
  }

  let _fixtureSnapshots = [];

  async function loadFixture(fn) {
    if (typeof fn !== 'function' || fn.name === '') {
      // Anonymous fixtures resolve to a fresh function reference per
      // test, so the cache lookup always misses and the deploy fires
      // every time. Reject loudly so the user names the fixture.
      throw new Error(
        'loadFixture: anonymous fixtures are not supported. Pass a named function ' +
          '(e.g. `async function myFixture() { … }`) so the cache can key on its reference.',
      );
    }
    const hre = deps.context;
    const { tronWeb } = hre.tre.makeTronWeb();
    // Pre-fund derived signers BEFORE any snapshot is taken. Without
    // this, the first fixture that doesn't itself call `getSigners()`
    // captures a snapshot of the unfunded state; later fixtures that
    // DO call `getSigners()` add the funding, and reverting to the
    // earlier snapshot strips that funding (the patched FullNode's
    // `restoreStore` deletes keys not present in the snapshot, which
    // includes any `AccountStore` entries created by
    // `tre_setAccountBalance`). Symptom: "Contract validate error:
    // account [T…] does not exist" when a test routes a tx through
    // one of the derived signers. Idempotent — `buildSigners` caches
    // the array.
    await makeSigners(hre);
    if (!(await deps.capabilities.supportsPatched(tronWeb))) {
      throw new Error(
        'loadFixture requires patched TRE snapshot/revert support',
      );
    }

    const snapshot = _fixtureSnapshots.find((s) => s.fixture === fn);
    if (snapshot === undefined) {
      // Fresh fixture: re-fund all signers to their full
      // `DEFAULT_BALANCE_SUN` before `fn()` runs and the snapshot is
      // taken. Without this, a previous test file's spending leaves
      // the deployer's balance well below what a Governor / metatx
      // fixture expects, and the fixture errors with
      // "balance is not sufficient" when it sends e.g. `parseEther("1")`
      // to the contract under test. `tre_setAccountBalance` is
      // idempotent (direct state mutation, not a transfer), so
      // re-funding has no side effects on chain history.
      await signersMod.refundSigners(hre);
    }
    if (snapshot !== undefined) {
      // Capture the snapshot id BEFORE `restore()` — `restore()`
      // reverts to it and then takes a fresh snapshot, overwriting
      // `restorer.snapshotId` with the NEW (higher) id. Newer
      // snapshots in the array were taken between this fixture's
      // last restore and now; the server-side `revert()` walked the
      // LinkedHashMap newest-first and dropped everything from
      // `oldId` onwards, so every `_fixtureSnapshots` entry with
      // `id > oldId` now references a server snapshot that no longer
      // exists. Without this eviction, the next `loadFixture` for
      // one of those evicted fixtures hits `tre_revert(unknown_id)`
      // and the whole describe-block "before each" hook errors out.
      const oldId = Number(snapshot.restorer.snapshotId);
      await snapshot.restorer.restore();
      const evicted = _fixtureSnapshots.filter(
        (s) => s !== snapshot && Number(s.restorer.snapshotId) > oldId,
      );
      _fixtureSnapshots = _fixtureSnapshots.filter(
        (s) => s === snapshot || Number(s.restorer.snapshotId) <= oldId,
      );
      // Fire-and-forget drops — failure (e.g. older fork without the
      // method) is benign because `revert()` also discards them
      // server-side; this is a memory-and-speed optimization only.
      for (const e of evicted) {
        rpcCall(tronWeb, 'tre_dropSnapshot', [e.restorer.snapshotId]).catch(
          () => {},
        );
      }
      return snapshot.data;
    }

    const data = await fn();
    const restorer = await _takeSnapshot(tronWeb);
    _fixtureSnapshots.push({ restorer, fixture: fn, data });
    return data;
  }

  // Wrap `hre.network.provider.send` / `.request` so upstream-EVM JSON-RPC
  // methods that TRE doesn't implement get translated into TRE's `tre_*`
  // equivalents (or stubbed) instead of hitting java-tron with a
  // `method not found` failure.
  //
  // Concrete cases:
  //   - `evm_setAutomine(false)` → `tre_blockTime(0)` (manual mining mode)
  //   - `evm_setAutomine(true)`  → `tre_blockTime(3)` (default 3s block production)
  //   - `evm_mine()`             → `tre_mine()` (one or N blocks)
  //   - `evm_increaseTime(s)`    → time-warp via tre_setNextBlockTimestamp+tre_mine
  //   - `eth_estimateGas`        → /wallet/triggerconstantcontract energy_used
  //
  // Upstream OZ tests use these (e.g. test/helpers/txpool.js's batchInBlock
  // disables auto-mine, sends N txs, mines one block, and asserts all txs
  // landed in the same block). Without this shim, ProviderError surfaces
  // at the test level and the test/file aborts.
  function patchHardhatProvider(hre) {
    const provider = hre.network && hre.network.provider;
    if (!provider || typeof provider.send !== 'function') {
      return;
    }
    if (provider._tronEvmShimInstalled) {
      return;
    }
    provider._tronEvmShimInstalled = true;

    const { mine: tre_mine } = deps.cheatcodes;
    const tw = () => hre.tre.makeTronWeb().tronWeb;

    const origSend = provider.send.bind(provider);
    const origRequest =
      typeof provider.request === 'function'
        ? provider.request.bind(provider)
        : null;

    async function handleEvm(method, params) {
      switch (method) {
        case 'evm_setAutomine': {
          // params: [boolean]. false → bt=0 (manual mining via tre_mine).
          // true → restore default 3s slot production.
          const enable = !!(params && params[0]);
          const r = await rpcCall(tw(), 'tre_blockTime', [enable ? 3 : 0]);
          if (r.error) {
            throw new Error(`tre_blockTime: ${JSON.stringify(r.error)}`);
          }
          return null;
        }
        case 'evm_mine': {
          // params: undefined | [count] | [{count}]
          let n = 1;
          if (params && params[0] !== null && params[0] !== undefined) {
            n =
              typeof params[0] === 'object'
                ? Number(params[0].count || 1)
                : Number(params[0]);
          }
          for (let i = 0; i < n; i++) {
            const r = await tre_mine(tw());
            if (!r.supported) {
              throw new Error(`tre_mine failed: ${r.reason}`);
            }
          }
          return '0x0';
        }
        case 'evm_increaseTime': {
          const seconds = Number(params && params[0]);
          await time.increase(tw(), BigInt(seconds));
          return seconds;
        }
        case 'evm_setNextBlockTimestamp': {
          const ts = Number(params && params[0]);
          await time.setNextBlockTimestamp(tw(), BigInt(ts));
          return null;
        }
        case 'evm_snapshot': {
          const r = await rpcCall(tw(), 'tre_snapshot', []);
          if (r.error) {
            throw new Error(`tre_snapshot: ${JSON.stringify(r.error)}`);
          }
          return r.result;
        }
        case 'evm_revert': {
          const id = params && params[0];
          const r = await rpcCall(tw(), 'tre_revert', [id]);
          if (r.error) {
            throw new Error(`tre_revert: ${JSON.stringify(r.error)}`);
          }
          return r.result;
        }
        default:
          return undefined; // sentinel: not handled by shim
      }
    }

    // Standalone eth_* shim — not all are evm_-prefixed.
    async function handleEthRpc(method, params) {
      if (method === 'eth_estimateGas') {
        // Best-effort gas estimate via triggerconstantcontract. Tests use
        // this to compute "less than estimate" gas limits for OOG forcing
        // (test/metatx/ERC2771Forwarder.test.js). TRE doesn't implement
        // eth_estimateGas via JSON-RPC; we run the call dry and read
        // energy_used, treating energy ≈ gas (1:1) at the test level.
        const txArg = (params && params[0]) || {};
        const fromBase58 = txArg.from
          ? signersMod.toBase58(txArg.from)
          : tw().defaultAddress.base58;
        const toBase58 = txArg.to ? signersMod.toBase58(txArg.to) : null;
        if (!toBase58) {
          return '0x5208';
        } // 21000 fallback
        const dataHex = (txArg.data || '0x').replace(/^0x/, '');
        try {
          const j = await requestJson(tw(), '/wallet/triggerconstantcontract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: jsonStringifyWithBigInts({
              owner_address: TronWeb.address.toHex(fromBase58),
              contract_address: TronWeb.address.toHex(toBase58),
              data: dataHex,
              call_value: valueToCallValue(txArg.value),
              visible: false,
            }),
          });
          const energy =
            j.energy_used ||
            (j.receipt && j.receipt.energy_usage_total) ||
            21000;
          return '0x' + Number(energy).toString(16);
        } catch {
          return '0x5208';
        }
      }
      return undefined;
    }

    provider.send = async function send(method, params) {
      if (typeof method === 'string') {
        if (method.startsWith('evm_')) {
          const handled = await handleEvm(method, params);
          if (handled !== undefined) {
            return handled;
          }
        } else {
          const handled = await handleEthRpc(method, params);
          if (handled !== undefined) {
            return handled;
          }
        }
      }
      return origSend(method, params);
    };

    if (origRequest) {
      provider.request = async function request(args) {
        if (args && typeof args.method === 'string') {
          if (args.method.startsWith('evm_')) {
            const handled = await handleEvm(args.method, args.params);
            if (handled !== undefined) {
              return handled;
            }
          } else {
            const handled = await handleEthRpc(args.method, args.params);
            if (handled !== undefined) {
              return handled;
            }
          }
        }
        return origRequest(args);
      };
    }
  }

  function install(hre) {
    if (!(hre.network && hre.network.config && hre.network.config.tron)) {
      return;
    }
    // Give the stubProvider a handle to hre so its lazy methods
    // (getCode/getBalance/getStorage/getBlockNumber) can build TronWeb.
    stubProvider._hre = hre;

    // Translate upstream-EVM JSON-RPC methods (`evm_*`, `eth_estimateGas`)
    // into TRE equivalents at the `hre.network.provider` layer. Without
    // this, tests that go through `provider.send('evm_mine')` etc. abort
    // with ProviderError before they reach any helper-module path.
    patchHardhatProvider(hre);

    if (!hre.ethers) {
      return;
    }

    // `args` is positional in tests (`deployContract(name, [a,b])`)
    // and sometimes followed by a signer
    // (`deployContract(name, [a,b], signer)`). The 3rd arg can also be
    // a plain `{value, gasLimit, …}` overrides object (proxy tests pass
    // `{value}` here to fund construction). Detect and route into the
    // args list as a trailing overrides element so
    // `deployViaFacade → splitOverrides` forwards it to `callValue`.
    hre.ethers.deployContract = (name, args = [], signerOrOpts = null) => {
      if (
        signerOrOpts &&
        typeof signerOrOpts === 'object' &&
        !signerOrOpts.tronWeb
      ) {
        const overrideKeys = [
          'value',
          'gasLimit',
          'gasPrice',
          'nonce',
          'from',
          'maxFeePerGas',
          'maxPriorityFeePerGas',
        ];
        if (overrideKeys.some((k) => k in signerOrOpts)) {
          return deployViaFacade(
            hre,
            name,
            [...(args || []), signerOrOpts],
            null,
          );
        }
      }
      return deployViaFacade(hre, name, args, signerOrOpts);
    };
    hre.ethers.getContractFactory = async (name, signerOrOptions = null) => {
      const signer =
        signerOrOptions &&
        typeof signerOrOptions === 'object' &&
        !('provider' in signerOrOptions) &&
        !('tronWeb' in signerOrOptions)
          ? signerOrOptions.signer
          : signerOrOptions;
      const artifact = await loadArtifact(hre, name);
      return makeFactory(hre, name, artifact, signer);
    };
    hre.ethers.getContractAt = async (name, address, signer = null) => {
      validateNativeSigner(signer);
      const artifact = await loadArtifact(hre, name);
      const tronWeb = signer?.tronWeb ?? hre.tre.makeTronWeb().tronWeb;
      return Promise.resolve(
        makeFacade(artifact.abi, toTronBase58(address), tronWeb, hre),
      );
    };
    hre.ethers.getSigners = () => makeSigners(hre);

    // Singular `getSigner(addr)`. A real derived signer is returned
    // when the address matches; otherwise an impersonating signer is
    // returned. The tx broadcast path still needs the patched
    // FullNode to whitelist `owner_address` (via `tre_impersonate
    // Account`), so callers that forget to register get a clear
    // "owner_address not impersonated" rejection from the chain
    // instead of a silent fallback to the deployer key.
    hre.ethers.getSigner = async (address) => {
      const base58 = signersMod.toBase58(address);
      const real = await makeSigners(hre);
      const match = real.find((s) => s.tronAddress === base58);
      if (match) {
        return match;
      }
      return makeImpersonatingSigner(hre, base58);
    };

    // CREATE2 on TVM uses
    // `keccak256(0x41 || sender || salt || initHash)[12:]` — verified
    // against on-chain deploys, and the in-tree CREATE2 libraries are
    // patched to hash with the `0x41` prefix as well. This override
    // is the matching half for those contract-side patches: every
    // test that compares an off-chain prediction against
    // `factory.$computeAddress(...)` /
    // `factory.predictDeterministicAddress(...)` would otherwise see
    // EVM-formula (0xff) on the JS side vs TVM-formula (0x41) in the
    // contract. Without it the CREATE2 suites all fail with
    // prefix-byte address mismatches.
    hre.ethers.getCreate2Address = (from, salt, initCodeHash) => {
      const fromHex = ethersV6.getAddress(asAddressString(from));
      const concat = ethersV6.concat(['0x41', fromHex, salt, initCodeHash]);
      return ethersV6.getAddress(
        ethersV6.dataSlice(ethersV6.keccak256(concat), 12),
      );
    };

    // Replace `hre.ethers.provider` with the stub. hardhat-ethers's
    // provider points at the EVM JSON-RPC, which our java-tron
    // FullNode doesn't fully serve; the stub forwards reads to
    // TronWeb and keeps `getTransactionReceipt` resolving against the
    // bridge's cache.
    hre.ethers.provider = stubProvider;

    // Chai matchers' `reverted` matcher hits
    // `hre.ethers.provider.getTransactionReceipt` directly. Wire that
    // through the local receipt cache so matchers resolve against the
    // value the deploy / tx path already stored.
    if (hre.ethers.provider) {
      const original = hre.ethers.provider.getTransactionReceipt
        ? hre.ethers.provider.getTransactionReceipt.bind(hre.ethers.provider)
        : null;
      hre.ethers.provider.getTransactionReceipt = async function (hash) {
        const cached = knownReceipts.get(hash);
        if (cached) {
          return cached;
        }
        if (original) {
          try {
            return await original(hash);
          } catch {
            return null;
          }
        }
        return null;
      };
    }
  }

  return {
    install,
    takeSnapshot: () => _takeSnapshot(deps.context.tre.makeTronWeb().tronWeb),
    // Construction + dispatch primitives. Surfaced for tests and
    // other plugin modules that want a facade or factory without
    // going through `hre.ethers`.
    makeFacade,
    makeFactory,
    deployViaFacade,
    makeSigners,
    loadFixture,

    // Surfaced for `src/runtime/deploy.js` so its constructor-revert
    // path can throw an ethers-shaped error with `.data` for chai
    // matchers' `revertedWithCustomError`. Lazy-required from deploy.js
    // to break a load-order cycle with the bridge.
    buildRevertError,

    // Address utilities. Tests use these to convert between TRON
    // base58 and ethers checksummed hex without importing TronWeb
    // directly.
    tronToHex,
    toTronBase58,

    // Pre-build cache surfaced so signers' `predictAddress` can stash
    // a pre-signed `CreateSmartContract` tx that the next
    // `ethers.deployContract(name, args, signer)` call broadcasts
    // verbatim. Lazy-required from signers.js to avoid the
    // bridge ↔ signers module-load cycle.
    _prebuildCache,
    prepareDeployment,

    // Artifact loader for signers' `predictAddress`.
    loadArtifact,
  };
};
