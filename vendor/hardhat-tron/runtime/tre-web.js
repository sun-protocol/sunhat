'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule() {
  // Constructs a TronWeb client from the active Hardhat network config.
  // Assumes the active network is `tre` (a local java-tron container);
  // Shasta and mainnet are not configured here.
  //
  // TronWeb's constructor sets up multiple HTTP clients with axios
  // interceptors and fee estimators — cheap individually but adds up
  // when called per test (`ethers.deployContract` re-builds it every
  // fixture). Cache one instance per (network, privateKey) tuple; tests
  // that need a fresh client can build one manually.
  const _tronWebCache = new Map();

  // TronWeb's default axios timeout for `/wallet/*` HTTP calls is 30 s.
  // In long parallel runs java-tron's state-store / snapshot
  // LinkedHashMap grows large enough that some individual tx
  // round-trips stall well past 30 s — and past 120 s in the worst
  // cases — under JVM GC pressure or state-warmup. The HTTP layer
  // surfaces those as `AxiosError: timeout of Nms exceeded` even though
  // TRE itself recovers a beat later. 300 s gives the slow-tail txs
  // enough headroom without papering over genuine hangs (anything
  // beyond five minutes is still a real failure mode worth surfacing).
  const HTTP_TIMEOUT_MS = 300_000;

  function makeTronWeb(hre) {
    const { TronWeb, providers } = require('tronweb');
    const { HttpProvider } = providers;

    const accounts = hre.network.config.accounts || [];
    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error(
        `No private key configured for network ${hre.network.name}. Set one in hardhat.config.cjs.`,
      );
    }

    const raw = accounts[0];
    const pk = raw.startsWith('0x') ? raw.slice(2) : raw;
    const url = hre.network.config.url.replace(/\/jsonrpc$/i, '');

    const cacheKey = `${url}:${pk}`;
    const cached = _tronWebCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // The network config stores the full-node URL with a trailing
    // `/jsonrpc`; the TronWeb client expects the bare host. Pass a
    // pre-built HttpProvider so the axios timeout can be raised
    // (TronWeb's string-URL constructor would use the default 30 s).
    const provider = new HttpProvider(url, HTTP_TIMEOUT_MS);
    const tronWeb = new TronWeb({ fullHost: provider, privateKey: pk });
    const entry = { tronWeb, address: tronWeb.address.fromPrivateKey(pk) };
    _tronWebCache.set(cacheKey, entry);
    return entry;
  }

  return { makeTronWeb };
};
