'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule(deps) {
  // TVM-aware replacements for `@nomicfoundation/hardhat-chai-matchers`'
  // `changeTokenBalance(s)` and `changeEtherBalance(s)`. The upstream
  // matchers query historical state via
  // `provider.send("eth_getBlockByHash", …)` and
  // `eth_getBalance(addr, blockTag)`, which our patched java-tron
  // FullNode does NOT serve — `eth_getBlockByHash` returns
  // NullPointerException, and `eth_getBalance` with a numeric
  // blockTag returns "QUANTITY not supported, just support TAG as
  // latest".
  //
  // Strategy:
  //   * Token: parse `Transfer(address,address,uint256)` events from
  //     receipt logs filtered by the token contract's address. No
  //     historical state lookup needed — events ARE the ledger.
  //   * Ether: combine the OUTER tx's (from, to, callValue) with the
  //     receipt's `internal_transactions[]` (caller_address,
  //     transferTo_address, callValueInfo[*].callValue, rejected). The
  //     bridge threads outer-call metadata into the response via
  //     `makeTxResponse(…, { from, to, value })`;
  //     `getTransactionInfo` supplies internals for nested CALL
  //     frames.
  //
  // chai's `Assertion.addMethod(name, fn)` REPLACES the prior
  // registration, so installing the TVM versions after
  // `hardhat-chai-matchers`' `chai.use(…)` runs is sufficient. The
  // originals don't need to be disabled — last registration wins.

  const { ethers: ethersV6 } = require('ethers');
  const { TronWeb } = require('tronweb');
  const { lookupTvmActualBase58 } = deps.cheatcodes;

  const ERC20_TRANSFER_TOPIC = ethersV6.id('Transfer(address,address,uint256)');
  // Unit model: 1 wei == 1 sun pass-through on the JS↔TVM boundary;
  // see the unit-model comment in `cheatcodes.js`. The bridge does no
  // conversion at send time, so the values reported by `tx.valueSun`,
  // `internal_transactions`, and `receipt.feeSun` are directly
  // comparable to the `expected` wei values callers pass via
  // `ethers.WeiPerEther` / `parseEther()`. No scaling needed.

  // --- address normalization ---------------------------------------

  function asAddressString(value) {
    if (!value) {
      return value;
    }
    // Signer / contract / addressable
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value.address === 'string') {
      return value.address;
    }
    if (typeof value.target === 'string') {
      return value.target;
    }
    if (typeof value.tronAddress === 'string') {
      return value.tronAddress;
    }
    return value;
  }

  // Returns a lowercased 0x-prefixed 42-char hex address (20-byte body),
  // suitable for `===` against `log.topics[1]`/`log.address` after
  // they're also normalized.
  function normalizeAddrLower(value) {
    const s = asAddressString(value);
    if (typeof s !== 'string') {
      return s;
    }
    // EVM-pred → TVM-actual rewrite. If the user passed an EVM-simulator
    // address (e.g. a Clones `instance.target` returned by staticCall) and
    // we've since seen the broadcast CREATE that maps it to a TVM-actual
    // address, normalize to the TVM-actual one so internal_tx
    // ether-balance accounting matches. See cheatcodes.js `_evmToTvm`.
    try {
      const remappedBase58 = lookupTvmActualBase58(s);
      if (remappedBase58) {
        const hex21 = TronWeb.address.toHex(remappedBase58);
        return '0x' + hex21.slice(2).toLowerCase();
      }
    } catch {
      /* */
    }
    if (s.startsWith('T') && s.length === 34) {
      const hex21 = TronWeb.address.toHex(s);
      return '0x' + hex21.slice(2).toLowerCase();
    }
    if (s.startsWith('0x') && s.length === 42) {
      return s.toLowerCase();
    }
    // Already 21-byte hex with 0x41 prefix?
    if (s.startsWith('41') && s.length === 42) {
      return '0x' + s.slice(2).toLowerCase();
    }
    if (s.startsWith('0x41') && s.length === 44) {
      return '0x' + s.slice(4).toLowerCase();
    }
    return typeof s === 'string' ? s.toLowerCase() : s;
  }

  async function formatAddress(account) {
    if (!account) {
      return String(account);
    }
    if (typeof account === 'string') {
      return account;
    }
    if (typeof account.address === 'string') {
      return account.address;
    }
    if (typeof account.getAddress === 'function') {
      return await account.getAddress();
    }
    return String(account);
  }

  // --- token (ERC20) balance from Transfer events ------------------

  const ZERO_ADDR_LOWER = '0x0000000000000000000000000000000000000000';

  function tokenBalanceChange(receipt, tokenAddrLower, accountAddrLower) {
    if (!receipt || !Array.isArray(receipt.logs)) {
      return 0n;
    }
    // Upstream chai-matchers reads `balanceOf(account)` before/after the
    // tx and reports the diff. ERC20 implementations (incl. OZ's) never
    // store a balance for the zero address, so balanceOf(0) is constant
    // 0 across any tx — including mints (Transfer(0, to, x)) and burns
    // (Transfer(from, 0, x)) which use it as a sentinel. We approximate
    // upstream's balanceOf-diff by summing Transfer events below, but
    // need to short-circuit for the zero-address sentinel so e.g.
    // `changeTokenBalances([receiver, 0], [-fee, 0])` (ERC20FlashMint's
    // "default flash fee receiver" test, expecting the fee to be burned)
    // matches upstream semantics.
    if (accountAddrLower === ZERO_ADDR_LOWER) {
      return 0n;
    }
    let change = 0n;
    for (const log of receipt.logs) {
      if (!log || !log.address || !Array.isArray(log.topics)) {
        continue;
      }
      if (log.address.toLowerCase() !== tokenAddrLower) {
        continue;
      }
      // ERC20 Transfer is 3 topics (sig + indexed from + indexed to)
      // and a single uint256 in data. ERC721 Transfer has same shape
      // but value is a tokenId — we'd over-count if we ran ERC721 events
      // through this matcher, but OZ tests use `changeTokenBalance` only
      // on ERC20-shaped tokens; the matcher's `checkToken` rejects
      // anything without a `balanceOf` method, but doesn't gate on
      // ERC20 specifically. Treat this as an ERC20-only matcher to
      // match upstream semantics.
      if (log.topics.length !== 3) {
        continue;
      }
      if (log.topics[0].toLowerCase() !== ERC20_TRANSFER_TOPIC.toLowerCase()) {
        continue;
      }
      const from = '0x' + log.topics[1].slice(-40).toLowerCase();
      const to = '0x' + log.topics[2].slice(-40).toLowerCase();
      const value = BigInt(log.data || '0x0');
      if (from === accountAddrLower) {
        change -= value;
      }
      if (to === accountAddrLower) {
        change += value;
      }
    }
    return change;
  }

  async function getTokenAddrLower(token) {
    const addr =
      (typeof token.getAddress === 'function' && (await token.getAddress())) ||
      token.target ||
      token.address;
    return normalizeAddrLower(addr);
  }

  // --- ether balance from outer tx + internal_transactions ---------

  // Returns sun-denominated balance changes for an array of accounts
  // given a fully-resolved tx response. Resolves to wei outside.
  //
  // Sources of value flow per tx:
  //   1. OUTER call: from = response.from, to = response.to,
  //      value = response.value (callValue, sun). Gas fee is
  //      response.gasUsed * response.gasPrice (sun).
  //   2. INNER calls: receipt-info `internal_transactions` array,
  //      each with caller_address (21-byte hex), transferTo_address,
  //      callValueInfo[*].callValue (sun), rejected (skip if true).
  //
  // `includeFee`: when false (chai-matchers default) and the account
  // is the outer tx sender, ADD BACK the gas fee — so the matcher
  // measures notional value delta, not "delta after gas".
  async function etherBalanceChangesSun(
    txResponse,
    accountsLower,
    hre,
    includeFee = false,
  ) {
    const changes = accountsLower.map(() => 0n);
    if (!txResponse) {
      return changes;
    }

    // --- outer call ---
    const fromLower = txResponse.from
      ? normalizeAddrLower(txResponse.from)
      : null;
    const toLower = txResponse.to ? normalizeAddrLower(txResponse.to) : null;
    const valueSun =
      txResponse.valueSun !== null && txResponse.valueSun !== undefined
        ? BigInt(txResponse.valueSun)
        : 0n;
    for (let i = 0; i < accountsLower.length; i++) {
      if (fromLower && accountsLower[i] === fromLower) {
        changes[i] -= valueSun;
      }
      if (toLower && accountsLower[i] === toLower) {
        changes[i] += valueSun;
      }
    }

    // --- gas fee deduction (sender pays) ---
    //
    // chai-matchers semantics:
    //   * includeFee=false (default) → report only value flow, excluding
    //     the gas the sender paid. Our outer-call step above already
    //     captured only value flow (no fee subtracted), so this is a
    //     no-op: changes[from] = -valueSun, no fee touched. The on-chain
    //     balance is more negative by feeSun, but the matcher hides that.
    //   * includeFee=true → also subtract the fee from sender, matching
    //     the full on-chain balance change.
    if (includeFee && fromLower) {
      const feeSun =
        txResponse.feeSun !== null && txResponse.feeSun !== undefined
          ? BigInt(txResponse.feeSun)
          : 0n;
      for (let i = 0; i < accountsLower.length; i++) {
        if (accountsLower[i] === fromLower) {
          changes[i] -= feeSun;
        }
      }
    }

    // --- internal transactions ---
    const internals = txResponse.internalTransactions || [];
    for (const itx of internals) {
      if (itx.rejected) {
        continue;
      }
      const itxFrom = normalizeAddrLower(
        itx.caller_address ? '0x' + itx.caller_address.slice(2) : null,
      );
      const itxTo = normalizeAddrLower(
        itx.transferTo_address ? '0x' + itx.transferTo_address.slice(2) : null,
      );
      let total = 0n;
      for (const cv of itx.callValueInfo || []) {
        if (
          cv &&
          cv.callValue !== null &&
          cv.callValue !== undefined &&
          (!cv.tokenId || cv.tokenId === '_' || cv.tokenId === '')
        ) {
          // TVM internal_transactions may carry token-IDs for TRC-10
          // value movements; we only count plain TRX (tokenId absent
          // or '_'). The default for a value-bearing CALL is '_'.
          // `cv.callValue` is preserved as either a Number, BigInt, or
          // a string (from waitForReceipt's BigInt-safe JSON parser) —
          // BigInt() accepts all three.
          total += BigInt(cv.callValue);
        }
      }
      if (total === 0n) {
        continue;
      }
      for (let i = 0; i < accountsLower.length; i++) {
        if (itxFrom && accountsLower[i] === itxFrom) {
          changes[i] -= total;
        }
        if (itxTo && accountsLower[i] === itxTo) {
          changes[i] += total;
        }
      }
    }

    return changes;
  }

  async function resolveTxResponse(subject) {
    if (typeof subject === 'function') {
      subject = subject();
    }
    return await subject;
  }

  // --- matcher: changeTokenBalance ---------------------------------

  function supportChangeTokenBalance(Assertion) {
    Assertion.addMethod(
      'changeTokenBalance',
      function (token, account, expected) {
        const negated = this.__flags.negate;
        const subject = this._obj;
        const derived = (async () => {
          const txResponse = await resolveTxResponse(subject);
          // makeTxResponse provides `wait()` returning the translated
          // receipt with decoded logs. If chai-matchers passed a bare
          // receipt (already awaited), use it directly.
          const receipt =
            txResponse && typeof txResponse.wait === 'function'
              ? await txResponse.wait()
              : txResponse;
          const tokenAddrLower = await getTokenAddrLower(token);
          const accountAddrLower = normalizeAddrLower(account);
          const actual = tokenBalanceChange(
            receipt,
            tokenAddrLower,
            accountAddrLower,
          );
          const expectedBig = toBigInt(expected);
          const matches = actual === expectedBig;
          if (negated ? matches : !matches) {
            const accountDesc = await formatAddress(account);
            const tokenDesc = await getTokenDescription(token, tokenAddrLower);
            throw new Error(
              negated
                ? `Expected the balance of ${tokenDesc} tokens for "${accountDesc}" NOT to change by ${expectedBig.toString()}, but it did`
                : `Expected the balance of ${tokenDesc} tokens for "${accountDesc}" to change by ${expectedBig.toString()}, but it changed by ${actual.toString()}`,
            );
          }
        })();
        this.then = derived.then.bind(derived);
        this.catch = derived.catch.bind(derived);
        this.promise = derived;
        return this;
      },
    );
  }

  function supportChangeTokenBalances(Assertion) {
    Assertion.addMethod(
      'changeTokenBalances',
      function (token, accounts, expected) {
        const negated = this.__flags.negate;
        const subject = this._obj;
        const derived = (async () => {
          if (Array.isArray(expected) && accounts.length !== expected.length) {
            throw new Error(
              `The number of accounts (${accounts.length}) is different than the number of expected balance changes (${expected.length})`,
            );
          }
          const txResponse = await resolveTxResponse(subject);
          const receipt =
            txResponse && typeof txResponse.wait === 'function'
              ? await txResponse.wait()
              : txResponse;
          const tokenAddrLower = await getTokenAddrLower(token);
          const accountAddrsLower = accounts.map(normalizeAddrLower);
          const actuals = accountAddrsLower.map((a) =>
            tokenBalanceChange(receipt, tokenAddrLower, a),
          );
          if (typeof expected === 'function') {
            // Predicate form
            const ok = expected(actuals);
            if (negated ? ok : !ok) {
              throw new Error(
                negated
                  ? `Expected token balances NOT to satisfy the predicate, but they did`
                  : `Expected token balances to satisfy the predicate, but they didn't (got [${actuals.join(', ')}])`,
              );
            }
            return;
          }
          const expectedBig = expected.map(toBigInt);
          const matches = actuals.every((v, i) => v === expectedBig[i]);
          if (negated ? matches : !matches) {
            const tokenDesc = await getTokenDescription(token, tokenAddrLower);
            const addrDesc = await Promise.all(accounts.map(formatAddress));
            throw new Error(
              negated
                ? `Expected balances of ${tokenDesc} tokens for ${addrDesc.join(',')} NOT to change by [${expectedBig.join(',')}], but they did`
                : `Expected balances of ${tokenDesc} tokens for ${addrDesc.join(',')} to change by [${expectedBig.join(',')}], but they changed by [${actuals.join(',')}]`,
            );
          }
        })();
        this.then = derived.then.bind(derived);
        this.catch = derived.catch.bind(derived);
        this.promise = derived;
        return this;
      },
    );
  }

  // --- matcher: changeEtherBalance(s) -------------------------------

  function supportChangeEtherBalance(Assertion) {
    Assertion.addMethod(
      'changeEtherBalance',
      function (account, expected, options) {
        const negated = this.__flags.negate;
        const subject = this._obj;
        const hre = deps.context;
        const derived = (async () => {
          const txResponse = await resolveTxResponse(subject);
          // Ensure the tx has landed (so internal_transactions are populated)
          if (txResponse && typeof txResponse.wait === 'function') {
            await txResponse.wait();
          }
          const includeFee = !!(options && options.includeFee);
          const [changeSun] = await etherBalanceChangesSun(
            txResponse,
            [normalizeAddrLower(account)],
            hre,
            includeFee,
          );
          // 1 wei == 1 sun pass-through — no scaling.
          const actualWei = changeSun;
          const expectedBig = toBigInt(expected);
          const matches = actualWei === expectedBig;
          if (negated ? matches : !matches) {
            const addrDesc = await formatAddress(account);
            throw new Error(
              negated
                ? `Expected the ether balance of "${addrDesc}" NOT to change by ${expectedBig.toString()} wei, but it did`
                : `Expected the ether balance of "${addrDesc}" to change by ${expectedBig.toString()} wei, but it changed by ${actualWei.toString()} wei`,
            );
          }
        })();
        this.then = derived.then.bind(derived);
        this.catch = derived.catch.bind(derived);
        this.promise = derived;
        return this;
      },
    );
  }

  function supportChangeEtherBalances(Assertion) {
    Assertion.addMethod(
      'changeEtherBalances',
      function (accounts, expected, options) {
        const negated = this.__flags.negate;
        const subject = this._obj;
        const hre = deps.context;
        const derived = (async () => {
          const txResponse = await resolveTxResponse(subject);
          if (txResponse && typeof txResponse.wait === 'function') {
            await txResponse.wait();
          }
          const includeFee = !!(options && options.includeFee);
          const accountAddrsLower = accounts.map(normalizeAddrLower);
          const changesSun = await etherBalanceChangesSun(
            txResponse,
            accountAddrsLower,
            hre,
            includeFee,
          );
          // 1 wei == 1 sun pass-through — no scaling.
          const actualsWei = changesSun;
          if (typeof expected === 'function') {
            const ok = expected(actualsWei);
            if (negated ? ok : !ok) {
              throw new Error(
                negated
                  ? `Expected ether balances NOT to satisfy the predicate, but they did`
                  : `Expected ether balances to satisfy the predicate, but they didn't (got [${actualsWei.join(', ')}])`,
              );
            }
            return;
          }
          const expectedBig = expected.map(toBigInt);
          const matches = actualsWei.every((v, i) => v === expectedBig[i]);
          if (negated ? matches : !matches) {
            const addrDesc = await Promise.all(accounts.map(formatAddress));
            throw new Error(
              negated
                ? `Expected ether balances for [${addrDesc.join(',')}] NOT to change by [${expectedBig.map((b) => b.toString()).join(',')}] wei, but they did`
                : `Expected ether balances for [${addrDesc.join(',')}] to change by [${expectedBig.map((b) => b.toString()).join(',')}] wei, but they changed by [${actualsWei.map((b) => b.toString()).join(',')}] wei`,
            );
          }
        })();
        this.then = derived.then.bind(derived);
        this.catch = derived.catch.bind(derived);
        this.promise = derived;
        return this;
      },
    );
  }

  // --- helpers -----------------------------------------------------

  function toBigInt(v) {
    if (typeof v === 'bigint') {
      return v;
    }
    if (v === null || v === undefined) {
      return 0n;
    }
    return BigInt(v.toString());
  }

  const _tokenDescCache = new Map();
  async function getTokenDescription(token, tokenAddrLower) {
    if (_tokenDescCache.has(tokenAddrLower)) {
      return _tokenDescCache.get(tokenAddrLower);
    }
    let desc = `<token at ${tokenAddrLower}>`;
    try {
      if (typeof token.symbol === 'function') {
        desc = await token.symbol();
      }
    } catch {
      try {
        if (typeof token.name === 'function') {
          desc = await token.name();
        }
      } catch {
        /* keep default */
      }
    }
    _tokenDescCache.set(tokenAddrLower, desc);
    return desc;
  }

  // --- registration ------------------------------------------------

  let _registered = false;
  function register() {
    if (_registered) {
      return;
    }
    // Resolve chai from chai-matchers' install (same singleton in
    // CommonJS, so a plain `require('chai')` would also work; explicit
    // for clarity).
    const chai = require('chai');
    supportChangeTokenBalance(chai.Assertion);
    supportChangeTokenBalances(chai.Assertion);
    supportChangeEtherBalance(chai.Assertion);
    supportChangeEtherBalances(chai.Assertion);
    _registered = true;
  }

  return { register };
};
