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
  const { createHttpProvider } = require('./transport');

  function makeTronWeb(hre) {
    const { TronWeb } = require('tronweb');

    const accounts = hre.network.config.accounts || [];
    const raw = accounts[0];
    const pk =
      raw === undefined ? undefined : raw.startsWith('0x') ? raw.slice(2) : raw;
    const url = hre.network.config.url;

    const cacheKey = `${url}:${pk}`;
    const cached = _tronWebCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // The network config stores the full-node URL with a trailing
    // `/jsonrpc`; the TronWeb client expects the bare host. Pass a
    // pre-built HttpProvider so the axios timeout can be raised
    // (TronWeb's string-URL constructor would use the default 30 s).
    const provider = createHttpProvider(
      url,
      hre.network.config.timeout,
      hre.network.config.httpHeaders,
    );
    const tronWeb = new TronWeb({
      fullHost: provider,
      ...(pk === undefined ? {} : { privateKey: pk }),
    });
    if (pk === undefined) {
      tronWeb.setAddress(TronWeb.address.fromHex('41' + '0'.repeat(40)));
    }
    const entry = { tronWeb, address: tronWeb.defaultAddress.base58 };
    _tronWebCache.set(cacheKey, entry);
    return entry;
  }

  return { makeTronWeb };
};
