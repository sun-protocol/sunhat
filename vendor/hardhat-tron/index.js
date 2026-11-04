'use strict';

const ethers = require('ethers');
const { AsyncLocalStorage } = require('node:async_hooks');
const createCheatcodes = require('./runtime/cheatcodes');
const createTime = require('./runtime/time');
const createSigners = require('./runtime/signers');
const createTreWeb = require('./runtime/tre-web');
const createWait = require('./runtime/wait');
const createDeploy = require('./runtime/deploy');
const createBridge = require('./runtime/ethers-bridge');
const createLifecycleModule = require('./tre/lifecycle');
const subjects = new WeakMap();

function createRuntime(input) {
  const originalProvider = input.network.provider;
  const forwarding = new AsyncLocalStorage();
  const network = {
    ...input.network,
    provider: {
      request: (args) =>
        (
          forwarding.getStore() ??
          originalProvider.request.bind(originalProvider)
        )(args),
      send: (method, params = []) =>
        originalProvider.request({ method, params }),
    },
  };
  const context = { ...input, network, ethers: { ...ethers, ...input.ethers } };
  context.registerSubject = (subject) => {
    subjects.set(subject, context);
    return subject;
  };
  const deps = { context };
  deps.cheatcodes = createCheatcodes();
  deps.capabilities = require('./runtime/capabilities')(deps.cheatcodes);
  deps.time = createTime(deps);
  deps.signers = createSigners(deps);
  deps.treWeb = createTreWeb();
  deps.wait = createWait(deps);
  deps.deploy = createDeploy(deps);
  deps.bridge = createBridge(deps);
  const makeTronWeb = () => deps.treWeb.makeTronWeb(context);
  const lifecycle = input.lifecycle ?? createLifecycle();
  context.tre = {
    ...deps.cheatcodes,
    ...deps.deploy,
    ...deps.wait,
    makeTronWeb,
    instanceId: () =>
      lifecycle.instanceId({
        networkName: context.network.name,
        url: context.network.config.url,
        httpHeaders: context.network.config.httpHeaders,
        provider: context.network.provider,
      }),
  };
  deps.bridge.install(context);

  const tw = () => makeTronWeb().tronWeb;
  const requireSupported = async (operation, pending) => {
    const result = await pending;
    if (!result.supported) {
      throw new Error(
        `${operation} requires a compatible patched TRE: ${result.reason}`,
      );
    }
    return result;
  };
  const helpers = {
    loadFixture: deps.bridge.loadFixture,
    takeSnapshot: deps.bridge.takeSnapshot,
    mine: (blocks = 1) => deps.time.mine(tw(), blocks),
    mineUpTo: (block) => deps.time.mineUpTo(tw(), block),
    time: Object.fromEntries(
      Object.entries(deps.time).map(([name, action]) => [
        name,
        (...args) => action(tw(), ...args),
      ]),
    ),
    setBalance: (address, balance) =>
      requireSupported(
        'setBalance',
        deps.cheatcodes.setAccountBalance(
          tw(),
          deps.bridge.toTronBase58(address),
          balance,
        ),
      ),
    setCode: (address, code) =>
      requireSupported(
        'setCode',
        deps.cheatcodes.setAccountCode(
          tw(),
          deps.bridge.toTronBase58(address),
          code,
        ),
      ),
    setStorageAt: (address, slot, value) =>
      requireSupported(
        'setStorageAt',
        deps.cheatcodes.setAccountStorageAt(
          tw(),
          deps.bridge.toTronBase58(address),
          slot,
          value,
        ),
      ),
    impersonateAccount: async (address) => {
      const base58 = deps.bridge.toTronBase58(address);
      await requireSupported(
        'impersonateAccount',
        deps.cheatcodes.impersonateAccount(tw(), base58),
      );
      deps.cheatcodes.registerLocalImpersonation(base58);
    },
    stopImpersonatingAccount: async (address) => {
      const base58 = deps.bridge.toTronBase58(address);
      await requireSupported(
        'stopImpersonatingAccount',
        deps.cheatcodes.stopImpersonatingAccount(tw(), base58),
      );
      deps.cheatcodes.unregisterLocalImpersonation(base58);
    },
  };
  context.tre.helpers = helpers;
  return {
    ethers: context.ethers,
    tre: context.tre,
    helpers,
    request: (args, next) =>
      forwarding.run(next, () => context.network.provider.request(args)),
  };
}

function createLifecycle(options = {}) {
  const deps = { ...options };
  const lifecycle = createLifecycleModule(deps);
  deps.instanceIds = require('./runtime/instance-id')({ lifecycle });
  return { ...lifecycle, instanceId: deps.instanceIds.instanceId };
}

function createCompiler(options = {}) {
  const deps = { ...options, errors: require('./compile/errors')() };
  deps.manifest = require('./compile/manifest')(deps);
  return { ...deps.manifest, ...require('./compile/downloader')(deps) };
}

let matchers;
function registerMatchers() {
  matchers ??= require('./runtime/chai-matchers-tvm')({
    resolveContext: (subject) => subjects.get(subject),
  });
  matchers.register();
}
module.exports = {
  createRuntime,
  createLifecycle,
  createCompiler,
  registerMatchers,
};
