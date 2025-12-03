import './type-extensions';
import path from 'path';
import fs from 'fs-extra';
import murmur128 from 'murmur-128';
import {
  HardhatRuntimeEnvironment,
  HardhatConfig,
  HardhatUserConfig,
  EthereumProvider,
  Artifact,
  BuildInfo,
  NetworkConfig,
} from 'hardhat/types';
import { createProvider } from 'hardhat/internal/core/providers/construction'; // TODO harhdat argument types not from internal
import { LazyInitializationProviderAdapter } from 'hardhat/internal/core/providers/lazy-initialization';
import { Deployment, ExtendedArtifact } from '../types';
import { extendEnvironment, task, subtask, extendConfig } from 'hardhat/config';
import { HARDHAT_NETWORK_NAME, HardhatPluginError } from 'hardhat/plugins';
import * as types from 'hardhat/internal/core/params/argumentTypes'; // TODO harhdat argument types not from internal
import {
  TASK_NODE,
  TASK_TEST,
  TASK_NODE_GET_PROVIDER,
  TASK_NODE_SERVER_READY,
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
} from 'hardhat/builtin-tasks/task-names';
import { lazyObject } from 'hardhat/plugins';
import { loadTronSolc } from './tron/solc';
import { OpenAI, AzureOpenAI } from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { glob } from 'glob';

import debug from 'debug';
const log = debug('hardhat:sun-protocol:tron-studio');

import { DeploymentsManager } from './DeploymentsManager';
import chokidar from 'chokidar';
import { submitSources } from './etherscan';
import { submitSourcesToSourcify } from './sourcify';
import { Network } from 'hardhat/types/runtime';
import { store } from './globalStore';
import { getDeployPaths, getNetworkName } from './utils';
import { LlmConfig, LlmProviderConfig } from './llm';

export { getNetworkName };

export const TASK_DEPLOY = 'deploy';
export const TASK_DEPLOY_MAIN = 'deploy:main';
export const TASK_DEPLOY_RUN_DEPLOY = 'deploy:runDeploy';
export const TASK_EXPORT = 'export';
export const TASK_ETHERSCAN_VERIFY = 'etherscan-verify';
export const TASK_SOURCIFY = 'sourcify';
// need to reexport all hardhat types. Sometimes intellisense will not correctly take into account the augmented interfaces set in type-extensions.ts
// even if this plug-in is correctly imported.
// importing the hardhat types from this package rather than hardhat is a workaround that issue.
export * from 'hardhat/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nodeTaskArgs: Record<string, any> = {};

function isHardhatEVM(hre: HardhatRuntimeEnvironment): boolean {
  const { network } = hre;
  return network.name === HARDHAT_NETWORK_NAME;
}

function normalizePathArray(config: HardhatConfig, paths: string[]): string[] {
  const newArray: string[] = [];
  for (const value of paths) {
    if (value) {
      newArray.push(normalizePath(config, value, value));
    }
  }
  return newArray;
}

function normalizePath(
  config: HardhatConfig,
  userPath: string | undefined,
  defaultPath: string,
): string {
  if (userPath === undefined) {
    userPath = path.join(config.paths.root, defaultPath);
  } else {
    if (!path.isAbsolute(userPath)) {
      userPath = path.normalize(path.join(config.paths.root, userPath));
    }
  }
  return userPath;
}

extendConfig(
  (config: HardhatConfig, userConfig: Readonly<HardhatUserConfig>) => {
    config.paths.deployments = normalizePath(
      config,
      userConfig.paths?.deployments,
      'deployments',
    );

    config.paths.imports = normalizePath(
      config,
      userConfig.paths?.imports,
      'imports',
    );

    if (userConfig.paths?.deploy) {
      let deployPaths = [];
      if (typeof userConfig.paths.deploy === 'string') {
        deployPaths = [userConfig.paths.deploy];
      } else {
        deployPaths = userConfig.paths.deploy;
      }
      config.paths.deploy = deployPaths.map((p) =>
        normalizePath(config, p, 'deploy'),
      );
    } else {
      config.paths.deploy = [normalizePath(config, undefined, 'deploy')];
    }

    if (userConfig.namedAccounts) {
      config.namedAccounts = userConfig.namedAccounts;
    } else {
      config.namedAccounts = { default: { default: 0 } };
    }

    config.deterministicDeployment = userConfig.deterministicDeployment;

    if (userConfig.external) {
      if (!config.external) {
        config.external = {};
      }
      if (userConfig.external.contracts) {
        const externalContracts: { artifacts: string[]; deploy?: string }[] =
          [];
        config.external.contracts = externalContracts;
        for (const userDefinedExternalContracts of userConfig.external
          .contracts) {
          const userArtifacts =
            typeof userDefinedExternalContracts.artifacts === 'string'
              ? [userDefinedExternalContracts.artifacts]
              : userDefinedExternalContracts.artifacts;
          externalContracts.push({
            artifacts: userArtifacts.map((v) => normalizePath(config, v, v)),
            deploy: userDefinedExternalContracts.deploy
              ? normalizePath(
                  config,
                  userDefinedExternalContracts.deploy,
                  userDefinedExternalContracts.deploy,
                )
              : undefined,
          });
        }
      }
      if (userConfig.external.deployments) {
        config.external.deployments = {};
        for (const key of Object.keys(userConfig.external.deployments)) {
          config.external.deployments[key] = normalizePathArray(
            config,
            userConfig.external.deployments[key],
          );
        }
      }
    }

    for (const compiler of config.solidity.compilers) {
      setupExtraSolcSettings(compiler.settings);
    }

    const defaultConfig = {};
    if (userConfig.verify !== undefined) {
      const customConfig = userConfig.verify;
      config.verify = { ...defaultConfig, ...customConfig };
    } else {
      config.verify = defaultConfig;
      // backward compatibility for runtime (js)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((userConfig as any).etherscan) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config.verify.etherscan = (userConfig as any).etherscan;
      }
    }
  },
);

function createNetworkFromConfig(
  env: HardhatRuntimeEnvironment,
  networkName: string,
  config: NetworkConfig,
): Network {
  const tags: { [tag: string]: boolean } = {};
  const tagsCollected = config.tags || [];
  for (const tag of tagsCollected) {
    tags[tag] = true;
  }

  const network = {
    name: networkName,
    config,
    live: config.live,
    saveDeployments: config.saveDeployments,
    zksync: config.zksync,
    tron: config.tron,
    tags,
    deploy: config.deploy || env.config.paths.deploy,
    companionNetworks: {},
  };
  networkFromConfig(env, network as Network, false);
  return network as Network;
}

function networkFromConfig(
  env: HardhatRuntimeEnvironment,
  network: Network,
  companion: boolean,
) {
  let live = true;
  const networkName = network.name; // cannot use fork here as this could be set via task, T
  if (networkName === 'localhost' || networkName === 'hardhat') {
    // the 2 default network are not live network
    live = false;
  }
  if (network.config.live !== undefined) {
    live = network.config.live;
  }

  if (network.config.verify !== undefined) {
    network.verify = network.config.verify;
  } else {
    // backward compatibility for runtime (js)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((network.config as any).etherscan) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      network.verify = { etherscan: (network.config as any).etherscan };
    }
  }

  if (network.config.zksync !== undefined) {
    network.zksync = network.config.zksync;
  }

  if (network.config.tron !== undefined) {
    network.tron = network.config.tron;
  }

  // associate tags to current network as object
  network.tags = {};
  const tags = network.config.tags || [];
  for (const tag of tags) {
    network.tags[tag] = true;
  }

  if (network.config.deploy) {
    network.deploy = network.config.deploy;
  } else {
    network.deploy = env.config.paths.deploy;
  }

  if (companion && network.config.companionNetworks) {
    network.companionNetworks = network.config.companionNetworks;
  } else {
    network.companionNetworks = {};
  }

  if (network.config.live !== undefined) {
    live = network.config.live;
  }

  network.live = live;

  if (network.config.saveDeployments === undefined) {
    network.saveDeployments = true;
  } else {
    network.saveDeployments = network.config.saveDeployments;
  }

  let autoImpersonate = false;

  if (networkName === 'hardhat') {
    autoImpersonate = true;
  }

  if (network.config.autoImpersonate !== undefined) {
    autoImpersonate = network.config.autoImpersonate;
  }

  network.autoImpersonate = autoImpersonate;
}

log('start...');
let deploymentsManager: DeploymentsManager;
extendEnvironment((env) => {
  networkFromConfig(env, env.network, true);
  if (deploymentsManager === undefined || env.deployments === undefined) {
    deploymentsManager = new DeploymentsManager(
      env,
      lazyObject(() => env.network), // IMPORTANT, else other plugin cannot set env.network before end, like solidity-coverage does here in the coverage task :  https://github.com/sc-forks/solidity-coverage/blob/3c0f3a5c7db26e82974873bbf61cf462072a7c6d/plugins/resources/nomiclabs.utils.js#L93-L98
    );
    env.deployments = deploymentsManager.deploymentsExtension;
    env.getNamedAccounts =
      deploymentsManager.getNamedAccounts.bind(deploymentsManager);
    env.getUnnamedAccounts =
      deploymentsManager.getUnnamedAccounts.bind(deploymentsManager);
    env.getChainId = () => {
      return deploymentsManager.getChainId();
    };

    for (const networkName of Object.keys(env.config.networks)) {
      const config = env.config.networks[networkName];
      if (!('url' in config) || networkName === 'hardhat') {
        continue;
      }
      store.networks[networkName] = createNetworkFromConfig(
        env,
        networkName,
        config,
      );
    }
  }
  initCompanionNetworks(env);
  log('ready');
});

function addIfNotPresent(array: string[], value: string) {
  if (array.indexOf(value) === -1) {
    array.push(value);
  }
}

function setupExtraSolcSettings(settings: {
  metadata: { useLiteralContent: boolean };
  outputSelection: { '*': { '': string[]; '*': string[] } };
}): void {
  settings.metadata = settings.metadata || {};
  settings.metadata.useLiteralContent = true;

  if (settings.outputSelection === undefined) {
    settings.outputSelection = {
      '*': {
        '*': [],
        '': [],
      },
    };
  }
  if (settings.outputSelection['*'] === undefined) {
    settings.outputSelection['*'] = {
      '*': [],
      '': [],
    };
  }
  if (settings.outputSelection['*']['*'] === undefined) {
    settings.outputSelection['*']['*'] = [];
  }
  if (settings.outputSelection['*'][''] === undefined) {
    settings.outputSelection['*'][''] = [];
  }

  addIfNotPresent(settings.outputSelection['*']['*'], 'abi');
  addIfNotPresent(settings.outputSelection['*']['*'], 'evm.bytecode');
  addIfNotPresent(settings.outputSelection['*']['*'], 'evm.deployedBytecode');
  addIfNotPresent(settings.outputSelection['*']['*'], 'metadata');
  addIfNotPresent(settings.outputSelection['*']['*'], 'devdoc');
  addIfNotPresent(settings.outputSelection['*']['*'], 'userdoc');
  addIfNotPresent(settings.outputSelection['*']['*'], 'storageLayout');
  addIfNotPresent(settings.outputSelection['*']['*'], 'evm.methodIdentifiers');
  addIfNotPresent(settings.outputSelection['*']['*'], 'evm.gasEstimates');
  // addIfNotPresent(settings.outputSelection["*"][""], "ir");
  // addIfNotPresent(settings.outputSelection["*"][""], "irOptimized");
  // addIfNotPresent(settings.outputSelection["*"][""], "ast");
}

function initCompanionNetworks(hre: HardhatRuntimeEnvironment) {
  hre.companionNetworks = {};
  for (const name of Object.keys(hre.network.companionNetworks)) {
    const networkName = hre.network.companionNetworks[name];
    // TODO Fork case ?
    if (networkName === hre.network.name) {
      deploymentsManager.addCompanionManager(name, deploymentsManager);
      const extraNetwork = {
        deployments: deploymentsManager.deploymentsExtension,
        getNamedAccounts: () => deploymentsManager.getNamedAccounts(),
        getUnnamedAccounts: () => deploymentsManager.getUnnamedAccounts(),
        getChainId: () => deploymentsManager.getChainId(),
        provider: lazyObject(() => hre.network.provider),
      };
      hre.companionNetworks[name] = extraNetwork;
      continue;
    }
    const config = hre.config.networks[networkName];
    if (!('url' in config) || networkName === 'hardhat') {
      throw new Error(
        `in memory network like hardhat are not supported as companion network`,
      );
    }

    const network = store.networks[networkName];
    if (!network) {
      throw new Error(`no network named ${networkName}`);
    }

    network.provider = new LazyInitializationProviderAdapter(() => {
      return createProvider(hre.config, networkName, hre.artifacts);
    });

    const networkDeploymentsManager = new DeploymentsManager(hre, network);
    deploymentsManager.addCompanionManager(name, networkDeploymentsManager);
    const extraNetwork = {
      deployments: networkDeploymentsManager.deploymentsExtension,
      getNamedAccounts: () => networkDeploymentsManager.getNamedAccounts(),
      getUnnamedAccounts: () => networkDeploymentsManager.getUnnamedAccounts(),
      getChainId: () => networkDeploymentsManager.getChainId(),
      provider: network.provider,
    };
    hre.companionNetworks[name] = extraNetwork;
  }
}

subtask(TASK_DEPLOY_RUN_DEPLOY, 'deploy run only')
  .addOptionalParam('export', 'export current network deployments')
  .addOptionalParam('exportAll', 'export all deployments into one file')
  .addOptionalParam(
    'tags',
    'specify which deploy script to execute via tags, separated by commas',
    undefined,
    types.string,
  )
  .addFlag(
    'tagsRequireAll',
    'execute only deploy scripts containing all the tags specified',
  )
  .addOptionalParam(
    'write',
    'whether to write deployments to file',
    true,
    types.boolean,
  )
  .addOptionalParam(
    'pendingtx',
    'whether to save pending tx',
    false,
    types.boolean,
  )
  .addOptionalParam(
    'gasprice',
    'gas price to use for transactions',
    undefined,
    types.string,
  )
  .addOptionalParam('maxfee', 'max fee per gas', undefined, types.string)
  .addOptionalParam(
    'priorityfee',
    'max priority fee per gas',
    undefined,
    types.string,
  )
  .addFlag('reset', 'whether to delete deployments files first')
  .addFlag('log', 'whether to output log')
  .addFlag('reportGas', 'report gas use')
  .setAction(async (args, hre) => {
    let tags = args.tags;
    if (typeof tags === 'string') {
      tags = tags.split(',');
    }
    await deploymentsManager.runDeploy(tags, {
      log: args.log,
      resetMemory: false,
      deletePreviousDeployments: args.reset,
      writeDeploymentsToFiles: args.write,
      export: args.export || process.env.HARDHAT_DEPLOY_EXPORT,
      exportAll: args.exportAll || process.env.HARDHAT_DEPLOY_EXPORT_ALL,
      savePendingTx: args.pendingtx,
      gasPrice: args.gasprice,
      maxFeePerGas: args.maxfee,
      maxPriorityFeePerGas: args.priorityfee,
      tagsRequireAll: args.tagsRequireAll,
    });
    if (args.reportGas) {
      console.log(`total gas used: ${hre.deployments.getGasUsed()}`);
    }
  });

subtask(TASK_DEPLOY_MAIN, 'deploy')
  .addOptionalParam('export', 'export current network deployments')
  .addOptionalParam('exportAll', 'export all deployments into one file')
  .addOptionalParam(
    'tags',
    'specify which deploy script to execute via tags, separated by commas',
    undefined,
    types.string,
  )
  .addFlag(
    'tagsRequireAll',
    'execute only deploy scripts containing all the tags specified',
  )
  .addOptionalParam(
    'write',
    'whether to write deployments to file',
    true,
    types.boolean,
  )
  .addOptionalParam(
    'pendingtx',
    'whether to save pending tx',
    false,
    types.boolean,
  )
  .addOptionalParam(
    'gasprice',
    'gas price to use for transactions',
    undefined,
    types.string,
  )
  .addOptionalParam('maxfee', 'max fee per gas', undefined, types.string)
  .addOptionalParam(
    'priorityfee',
    'max priority fee per gas',
    undefined,
    types.string,
  )
  .addFlag('noCompile', 'disable pre compilation')
  .addFlag('reset', 'whether to delete deployments files first')
  .addFlag('log', 'whether to output log')
  .addFlag('watch', 'redeploy on every change of contract or deploy script')
  .addFlag(
    'watchOnly',
    'do not actually deploy, just watch and deploy if changes occurs',
  )
  .addFlag('reportGas', 'report gas use')
  .setAction(async (args, hre) => {
    if (args.reset) {
      await deploymentsManager.deletePreviousDeployments(
        args.runAsNode ? 'localhost' : undefined,
      );
    }

    async function compileAndDeploy() {
      if (!args.noCompile) {
        await hre.run('compile');
      }
      return hre.run(TASK_DEPLOY_RUN_DEPLOY, { ...args, reset: false });
    }

    let currentPromise: Promise<{
      [name: string]: Deployment;
    }> | null = args.watchOnly ? null : compileAndDeploy();
    if (args.watch || args.watchOnly) {
      const deployPaths = getDeployPaths(hre.network);
      const watcher = chokidar.watch(
        [hre.config.paths.sources, ...deployPaths],
        {
          ignored: /(^|[/\\])\../, // ignore dotfiles
          persistent: true,
        },
      );

      watcher.on('ready', () =>
        console.log('Initial scan complete. Ready for changes'),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rejectPending: any = null;
      // eslint-disable-next-line no-inner-declarations,@typescript-eslint/no-explicit-any
      function pending(): Promise<void> {
        return new Promise((resolve, reject) => {
          rejectPending = reject;
          if (currentPromise) {
            currentPromise
              .then(() => {
                rejectPending = null;
                resolve();
              })
              .catch((error) => {
                rejectPending = null;
                currentPromise = null;
                console.error(error);
              });
          } else {
            rejectPending = null;
            resolve();
          }
        });
      }
      watcher.on('change', async () => {
        console.log('change detected');
        if (currentPromise) {
          console.log('deployment in progress, please wait ...');
          if (rejectPending) {
            // console.log("disabling previously pending redeployments...");
            rejectPending();
          }
          try {
            // console.log("waiting for current redeployment...");
            await pending();
            // console.log("pending finished");
          } catch (e) {
            return;
          }
        }
        currentPromise = compileAndDeploy();
        try {
          await currentPromise;
        } catch (e) {
          console.error(e);
        }
        currentPromise = null;
      });
      try {
        await currentPromise;
      } catch (e) {
        console.error(e);
      }
      currentPromise = null;
      await new Promise((resolve) => setTimeout(resolve, 2000000000)); // TODO better way ?
    } else {
      const firstDeployments = await currentPromise;
      return firstDeployments;
    }
  });

task(TASK_TEST, 'Runs mocha tests')
  .addFlag('deployFixture', 'run the global fixture before tests')
  .addFlag('noImpersonation', 'do not impersonate unknown accounts')
  .setAction(async (args, hre, runSuper) => {
    if (args.noImpersonation) {
      deploymentsManager.disableAutomaticImpersonation();
    }
    if (args.deployFixture || process.env.HARDHAT_DEPLOY_FIXTURE) {
      if (!args.noCompile) {
        await hre.run('compile');
      }
      await hre.deployments.fixture(undefined, {
        keepExistingDeployments: true, // by default reuse the existing deployments (useful for fork testing)
      });
      return runSuper({ ...args, noCompile: true });
    } else {
      return runSuper(args);
    }
  });

task(TASK_DEPLOY, 'Deploy contracts')
  .addOptionalParam('export', 'export current network deployments')
  .addOptionalParam('exportAll', 'export all deployments into one file')
  .addOptionalParam(
    'tags',
    'specify which deploy script to execute via tags, separated by commas',
    undefined,
    types.string,
  )
  .addFlag(
    'tagsRequireAll',
    'execute only deploy scripts containing all the tags specified',
  )
  .addOptionalParam(
    'write',
    'whether to write deployments to file',
    undefined,
    types.boolean,
  )
  // TODO pendingtx
  .addOptionalParam(
    'gasprice',
    'gas price to use for transactions',
    undefined,
    types.string,
  )
  .addOptionalParam('maxfee', 'max fee per gas', undefined, types.string)
  .addOptionalParam(
    'priorityfee',
    'max priority fee per gas',
    undefined,
    types.string,
  )
  .addOptionalParam(
    'deployScripts',
    'override deploy script folder path',
    undefined,
    types.string,
  )
  .addFlag('noImpersonation', 'do not impersonate unknown accounts')
  .addFlag('noCompile', 'disable pre compilation')
  .addFlag('reset', 'whether to delete deployments files first')
  .addFlag('silent', 'whether to remove log')
  .addFlag('watch', 'redeploy on every change of contract or deploy script')
  .addFlag('reportGas', 'report gas use')
  .setAction(async (args, hre) => {
    if (args.noImpersonation) {
      deploymentsManager.disableAutomaticImpersonation();
    }
    if (args.deployScripts) {
      // TODO support commas separated list
      hre.network.deploy = [
        normalizePath(hre.config, args.deployScripts, args.deployScripts),
      ];
      if (store.networks[getNetworkName(hre.network)]) {
        store.networks[getNetworkName(hre.network)].deploy = hre.network.deploy; // fallback to global store
      }
    }
    args.log = !args.silent;
    delete args.silent;
    if (args.write === undefined) {
      args.write = !isHardhatEVM(hre);
    }
    args.pendingtx = !isHardhatEVM(hre);
    await hre.run(TASK_DEPLOY_MAIN, args);
  });

task(
  TASK_EXPORT,
  'export contract deployment of the specified network into one file',
)
  .addOptionalParam('export', 'export current network deployments')
  .addOptionalParam('exportAll', 'export all deployments into one file')
  .setAction(async (args) => {
    await deploymentsManager.loadDeployments(false);
    await deploymentsManager.export({
      export: args.export || process.env.HARDHAT_DEPLOY_EXPORT,
      exportAll: args.exportAll || process.env.HARDHAT_DEPLOY_EXPORT_ALL,
    });
  });

async function enableProviderLogging(
  provider: EthereumProvider,
  enabled: boolean,
) {
  await provider.request({
    method: 'hardhat_setLoggingEnabled',
    params: [enabled],
  });
}

task(TASK_NODE, 'Starts a JSON-RPC server on top of Hardhat EVM')
  .addOptionalParam('export', 'export current network deployments')
  .addOptionalParam('exportAll', 'export all deployments into one file')
  .addOptionalParam(
    'tags',
    'specify which deploy script to execute via tags, separated by commas',
    undefined,
    types.string,
  )
  .addOptionalParam(
    'write',
    'whether to write deployments to file',
    true,
    types.boolean,
  )
  .addOptionalParam(
    'gasprice',
    'gas price to use for transactions',
    undefined,
    types.string,
  )
  .addOptionalParam('maxfee', 'max fee per gas', undefined, types.string)
  .addOptionalParam(
    'priorityfee',
    'max priority fee per gas',
    undefined,
    types.string,
  )
  // TODO --unlock-accounts
  .addFlag('noReset', 'do not delete deployments files already present')
  .addFlag('noImpersonation', 'do not impersonate unknown accounts')
  .addFlag('silent', 'whether to renove log')
  .addFlag('noDeploy', 'do not deploy')
  .addFlag('watch', 'redeploy on every change of contract or deploy script')
  .setAction(async (args, hre, runSuper) => {
    if (args.noImpersonation) {
      deploymentsManager.disableAutomaticImpersonation();
    }
    nodeTaskArgs = args;
    if (!isHardhatEVM(hre)) {
      throw new HardhatPluginError(
        `
Unsupported network for JSON-RPC server. Only hardhat is currently supported.
you can specifiy hardhat via "--network hardhat"
`,
      );
    }

    deploymentsManager.runAsNode(true);

    // console.log('node', args);
    await runSuper(args);
  });

subtask(TASK_NODE_GET_PROVIDER).setAction(
  async (args, hre, runSuper): Promise<EthereumProvider> => {
    const provider = await runSuper(args);

    if (!nodeTaskArgs.noReset) {
      await deploymentsManager.deletePreviousDeployments('localhost');
    }

    if (nodeTaskArgs.noDeploy) {
      // console.log('skip');
      return provider;
    }
    // console.log('enabling logging');
    await enableProviderLogging(provider, false);

    const networkName = getNetworkName(hre.network);
    if (networkName !== hre.network.name) {
      console.log(`copying ${networkName}'s deployment to localhost...`);
      // copy existing deployment from specified netwotk into localhost deployment folder
      await fs.copy(
        path.join(hre.config.paths.deployments, networkName),
        path.join(hre.config.paths.deployments, 'localhost'),
      );
    }

    nodeTaskArgs.log = !nodeTaskArgs.silent;
    delete nodeTaskArgs.silent;
    nodeTaskArgs.pendingtx = false;
    await hre.run(TASK_DEPLOY_MAIN, {
      ...nodeTaskArgs,
      watch: false,
      reset: false,
    });

    await enableProviderLogging(provider, true);

    return provider;
  },
);

subtask(TASK_NODE_SERVER_READY).setAction(async (args, hre, runSuper) => {
  await runSuper(args);

  if (nodeTaskArgs.watch) {
    await hre.run(TASK_DEPLOY_MAIN, {
      ...nodeTaskArgs,
      watchOnly: true,
      reset: false,
    });
  }
});

task(TASK_ETHERSCAN_VERIFY, 'submit contract source code to etherscan')
  .addOptionalParam('apiKey', 'etherscan api key', undefined, types.string)
  .addOptionalParam(
    'license',
    'SPDX license (useful if SPDX is not listed in the sources), need to be supported by etherscan: https://etherscan.io/contract-license-types',
    undefined,
    types.string,
  )
  .addOptionalParam(
    'apiUrl',
    'specify the url manually',
    undefined,
    types.string,
  )
  .addOptionalParam(
    'contractName',
    'specific contract name to verify',
    undefined,
    types.string,
  )
  .addFlag(
    'forceLicense',
    'force the use of the license specified by --license option',
  )
  .addFlag(
    'sleep',
    'sleep 500ms between each verification, so API rate limit is not exceeded',
  )
  .addFlag(
    'solcInput',
    'fallback on solc-input (useful when etherscan fails on the minimum sources, see https://github.com/ethereum/solidity/issues/9573)',
  )
  .addFlag(
    'writePostData',
    'write the post data on file in "etherscan_requests/<network>" folder, for debugging purpose',
  )
  .setAction(async (args, hre) => {
    const etherscanApiKey =
      args.apiKey ||
      process.env.ETHERSCAN_API_KEY ||
      hre.network.verify?.etherscan?.apiKey ||
      hre.config.verify?.etherscan?.apiKey;
    if (!etherscanApiKey) {
      throw new Error(
        `No Etherscan API KEY provided. Set it through command line option, in hardhat.config.ts, or by setting the "ETHERSCAN_API_KEY" env variable`,
      );
    }
    const solcInputsPath = await deploymentsManager.getSolcInputPath();
    await submitSources(hre, solcInputsPath, {
      contractName: args.contractName,
      etherscanApiKey,
      license: args.license,
      fallbackOnSolcInput: args.solcInput,
      forceLicense: args.forceLicense,
      sleepBetween: args.sleep,
      apiUrl: args.apiUrl || hre.network.verify?.etherscan?.apiUrl,
      writePostData: args.writePostData,
    });
  });

task(
  TASK_SOURCIFY,
  'submit contract source code to sourcify (https://sourcify.dev)',
)
  .addOptionalParam(
    'endpoint',
    'endpoint url for sourcify',
    undefined,
    types.string,
  )
  .addOptionalParam(
    'contractName',
    'specific contract name to verify',
    undefined,
    types.string,
  )
  .addFlag(
    'writeFailingMetadata',
    'write to disk failing metadata for easy debugging',
  )
  .setAction(async (args, hre) => {
    await submitSourcesToSourcify(hre, args);
  });

task('export-artifacts')
  .addPositionalParam(
    'dest',
    'destination folder where the extended artifacts files will be written to',
    undefined,
    types.string,
  )
  .addFlag(
    'solcInput',
    'if set, artifacts will have an associated solcInput files (required for old version of solidity to ensure verifiability',
  )
  .addFlag(
    'includingEmptyBytecode',
    'if set, even contract without bytecode (like interfaces) will be exported',
  )
  .addFlag(
    'includingNoPublicFunctions',
    'if set, even contract without public interface (like imternal libraries) will be exported',
  )
  .addOptionalParam(
    'exclude',
    'list of contract names separated by commas to exclude',
    undefined,
    types.string,
  )
  .addOptionalParam(
    'include',
    'list of contract names separated by commas to include. If specified, only these will be considered',
    undefined,
    types.string,
  )
  .addFlag(
    'hideSources',
    'if set, the artifacts files will not contain source code (metadata or other data exposing it) unless specified via --sources-for',
  )
  .addOptionalParam(
    'sourcesFor',
    'list of contract names separated by commas to include source (metadata,etc...) for (see --hide-sources)',
    undefined,
    types.string,
  )
  .setAction(async (args, hre) => {
    await hre.run('compile');
    const argsInclude: string[] = args.include ? args.include.split(',') : [];
    const checkInclude = argsInclude.length > 0;
    const include = argsInclude.reduce(
      (result: Record<string, boolean>, item: string) => {
        result[item] = true;
        return result;
      },
      {},
    );
    const argsExclude: string[] = args.exclude ? args.exclude.split(',') : [];
    const exclude = argsExclude.reduce(
      (result: Record<string, boolean>, item: string) => {
        result[item] = true;
        return result;
      },
      {},
    );
    const argsSourcesFor: string[] = args.sourcesFor
      ? args.sourcesFor.split(',')
      : [];
    const sourcesFor = argsSourcesFor.reduce(
      (result: Record<string, boolean>, item: string) => {
        result[item] = true;
        return result;
      },
      {},
    );
    const extendedArtifactFolderpath = args.dest;
    fs.emptyDirSync(extendedArtifactFolderpath);
    const artifactPaths = await hre.artifacts.getArtifactPaths();
    for (const artifactPath of artifactPaths) {
      const artifact: Artifact = await fs.readJSON(artifactPath);
      const artifactName = path.basename(artifactPath, '.json');
      if (exclude[artifactName]) {
        continue;
      }
      if (checkInclude && !include[artifactName]) {
        continue;
      }
      const artifactDBGPath = path.join(
        path.dirname(artifactPath),
        artifactName + '.dbg.json',
      );
      const artifactDBG = await fs.readJSON(artifactDBGPath);
      const buildinfoPath = path.join(
        path.dirname(artifactDBGPath),
        artifactDBG.buildInfo,
      );
      const buildInfo: BuildInfo = await fs.readJSON(buildinfoPath);
      const output =
        buildInfo.output.contracts[artifact.sourceName][artifactName];

      if (!args.includingNoPublicFunctions) {
        if (
          !artifact.abi ||
          artifact.abi.filter((v) => v.type !== 'event').length === 0
        ) {
          continue;
        }
      }

      if (!args.includingEmptyBytecode) {
        if (!artifact.bytecode || artifact.bytecode === '0x') {
          continue;
        }
      }

      // TODO decide on ExtendedArtifact vs Artifact vs Deployment type
      // save space by not duplicating bytecodes
      if (output.evm?.bytecode?.object) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (output.evm.bytecode.object as any) = undefined;
      }
      if (output.evm?.deployedBytecode?.object) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (output.evm.deployedBytecode.object as any) = undefined;
      }
      // -----------------------------------------

      const extendedArtifact: ExtendedArtifact = {
        ...artifact,
        ...output,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (extendedArtifact as any)._format = undefined;

      if (args.solcInput) {
        const solcInput = JSON.stringify(buildInfo.input, null, '  ');
        const solcInputHash = Buffer.from(murmur128(solcInput)).toString('hex');
        extendedArtifact.solcInput = solcInput;
        extendedArtifact.solcInputHash = solcInputHash;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let dataToWrite: any = extendedArtifact;
      if (args.hideSources && !sourcesFor[artifactName]) {
        dataToWrite = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          contractName: (extendedArtifact as any).contractName,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          sourceName: (extendedArtifact as any).sourceName,
          abi: extendedArtifact.abi,
          bytecode: extendedArtifact.bytecode,
          deployedBytecode: extendedArtifact.deployedBytecode,
          linkReferences: extendedArtifact.linkReferences,
          deployedLinkReferences: extendedArtifact.deployedLinkReferences,
          devdoc: extendedArtifact.devdoc,
          userdoc: extendedArtifact.userdoc,
          evm: extendedArtifact.evm
            ? {
                gasEstimates: extendedArtifact.evm.gasEstimates,
                methodIdentifiers: extendedArtifact.evm.methodIdentifiers,
              }
            : undefined,
        };
      }

      let filepath = path.join(
        extendedArtifactFolderpath,
        artifactName + '.json',
      );
      if (dataToWrite.sourceName) {
        if (dataToWrite.contractName) {
          filepath = path.join(
            extendedArtifactFolderpath,
            dataToWrite.sourceName,
            dataToWrite.contractName + '.json',
          );
        } else {
          filepath = path.join(
            extendedArtifactFolderpath,
            dataToWrite.sourceName,
            artifactName + '.json',
          );
        }
      }

      fs.ensureFileSync(filepath);
      fs.writeFileSync(filepath, JSON.stringify(dataToWrite, null, '  '));
    }
  });

subtask(
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
  async (
    args: {
      solcVersion: string;
    },
    hre,
    runSuper,
  ) => {
    const nw = hre.hardhatArguments['network']
      ? hre.hardhatArguments['network']
      : 'localhost';
    if (hre.config.networks[nw].tron && (hre.config as any)?.tronSolc?.enable) {
      // are we using tron-solc compiler and is the network a Tron network
      return await loadTronSolc(args.solcVersion);
    }
    return runSuper();
  },
);

type ProviderName = keyof LlmConfig['providers'];
type SupportedLanguage = 'solidity' | 'vyper';

/**
 * 统一的 LLM 调用函数
 * @param {string} provider - LLM 提供商 (e.g., 'openai', 'gemini')
 * @param {object} config - 该 provider 的配置 (apiKey, model, baseURL?)
 * @param {string} prompt - 发送给模型的 Prompt
 * @returns {Promise<string>} - 返回模型的分析结果文本
 */
async function callLLM(
  provider: ProviderName,
  config: LlmProviderConfig,
  prompt: string,
): Promise<string> {
  console.log(`[INFO] Using provider: ${provider}, model: ${config.model}`);
  // console.log(`[INFO] prompt: ${prompt}`);

  switch (provider) {
    case 'openai':
    case 'qwen':
    case 'deepseek': {
      // 这些模型使用 OpenAI 兼容的 API
      const openaiConfig = config as LlmConfig['providers']['openai'];
      const openai = new OpenAI({
        apiKey: openaiConfig.apiKey,
        baseURL: openaiConfig.baseURL,
      });
      const response = await openai.chat.completions.create({
        model: openaiConfig.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a professional and meticulous smart contract auditor.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      });
      return response.choices[0].message.content ?? '';
    }
    case 'azure_openai': {
      const azureConfig = config as LlmConfig['providers']['azure_openai'];

      const azureClient = new AzureOpenAI({
        endpoint: azureConfig.endpoint,
        apiKey: azureConfig.apiKey,
        apiVersion: azureConfig.apiVersion,
        deployment: azureConfig.deploymentName,
      });

      console.log(`[INFO] Using model deployment: ${azureConfig.model}`);
      const response = await azureClient.chat.completions.create({
        model: azureConfig.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a professional and meticulous smart contract auditor.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      });
      return response.choices[0].message.content ?? '';
    }
    case 'gemini': {
      const geminiConfig = config as LlmConfig['providers']['gemini'];
      const genAI = new GoogleGenerativeAI(geminiConfig.apiKey);
      const model = genAI.getGenerativeModel({ model: geminiConfig.model });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    }

    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

/**
 * 根据配置获取基础审计 Prompt
 * @param llmConfig - LLM 的配置对象
 * @returns {string} - 基础审计指令
 */
function getBasePromptTemplate(llmConfig: LlmConfig): string {
  const defaultPromptTemplate = `As an expert smart contract auditor, please analyze the following {language} code.
The file name is "{contractName}".

Your analysis should cover:
1.  **Security Vulnerabilities**: Identify potential risks.
2.  **Gas Optimization**: Suggest gas-saving improvements.
3.  **Best Practices**: Check for code style and common practices.`;

  const userPrompt = llmConfig.promptTemplate;
  return userPrompt || defaultPromptTemplate;
}

/**
 * 生成最终的审计 Prompt，结合了用户自定义部分和固定的格式要求
 * @param contractName - 合约名称
 * @param contractCode - 带行号的合约代码
 * @param format - 输出格式
 * @param llmConfig - LLM 配置，用于获取自定义 prompt
 * @param language - 合约语言
 * @returns {string} - 完整的 Prompt
 */
function getAuditPrompt(
  contractName: string,
  contractCode: string,
  format: 'text' | 'json',
  llmConfig: LlmConfig,
  language: SupportedLanguage,
): string {
  const codeWithLineNumbers = contractCode
    .split('\n')
    .map((line, index) => `${index + 1}: ${line}`) // 为每行加上 "行号: " 前缀
    .join('\n');

  let basePrompt = getBasePromptTemplate(llmConfig);
  basePrompt = basePrompt
    .replace('{contractName}', contractName)
    .replace('{codeWithLineNumbers}', codeWithLineNumbers)
    .replace('{language}', language);

  if (format === 'json') {
    return `
      ${basePrompt}

      Your response MUST be a single, valid JSON array of objects, enclosed in a single \`\`\`json code block. Do not add any text before or after the JSON block.
      Each object in the array represents a single issue you've found and must conform to this exact structure:
      {
        "severity": "HIGH" | "MEDIUM" | "LOW" | "INFO",
        "filePath": "${contractName}",
        "lineNumber": <number>,
        "message": "<A concise description of the issue>",
        "detailedDescription": "<A full explanation of the vulnerability or suggestion.>",
        "suggestion": "<A code snippet showing the recommended change. Use diff format if possible.>"
      }

      If you find no issues, return an empty array [].

      Now, analyze the following contract code:
      \`\`\`${language}
      ${codeWithLineNumbers}
      \`\`\`
    `;
  }

  return `
    ${basePrompt}

    **CRITICAL**: For each issue you find, you MUST format the title of the issue on a single line like this:
    [SEVERITY]|[FILE_PATH]:[LINE_NUMBER] - [BRIEF_DESCRIPTION]

    - **SEVERITY**: Use one of: HIGH, MEDIUM, LOW, INFO.
    - **FILE_PATH**: This MUST be the exact filename provided: ${contractName}.
    - **LINE_NUMBER**: The specific line number where the issue occurs.
    - **BRIEF_DESCRIPTION**: A short, one-sentence summary of the issue.

    After this title line, provide a detailed explanation and a code snippet with your suggested modification.

    Example of a single issue's format:
    ---
    MEDIUM|MyContract.sol:42 - Re-entrancy risk in the withdraw function.

    **Details**: The current implementation of the \`withdraw\` function updates the user's balance *after* the external call (transfer), which makes it vulnerable to a re-entrancy attack.

    **Recommendation**:
    \`\`\`diff
    - balance[msg.sender] = 0;
    - (bool sent, ) = msg.sender.call{value: amount}("");
    + (bool sent, ) = msg.sender.call{value: amount}("");
    + require(sent, "Failed to send Ether");
    + balance[msg.sender] = 0;
    \`\`\`
    ---

    Now, analyze the following contract code:
    \`\`\`${language}
    ${codeWithLineNumbers}
    \`\`\`
  `;
}

// 提取 Markdown JSON
function extractJson(rawOutput: string): string {
  const match = rawOutput.match(/```json\s*(\[[\s\S]*?\])\s*```/);
  if (!match || !match[1]) {
    try {
      JSON.parse(rawOutput);
      return rawOutput;
    } catch (e) {
      throw new Error(
        'Could not find a valid JSON code block or parse the raw output as JSON.',
      );
    }
  }
  return match[1];
}

interface AuditTaskArgs {
  contract?: string;
  provider?: ProviderName;
  format?: 'text' | 'json';
}

task('audit', 'Audits a smart contract using a specified LLM provider')
  .addOptionalParam(
    'contract',
    'The name of the contract file to audit (e.g., "MyContract.sol"). If not provided, audits all contracts.',
  )
  .addOptionalParam(
    'provider',
    'The LLM provider to use (openai, azure_openai, gemini, qwen, deepseek)',
  )
  .addOptionalParam('format', "The output format: 'text' (default) or 'json'")
  .setAction(
    async (taskArgs: AuditTaskArgs, hre: HardhatRuntimeEnvironment) => {
      const {
        contract: contractArg,
        provider: providerArg,
        format: formatArg,
      } = taskArgs;
      const { llm: llmConfig } = hre.config;
      const format = formatArg || 'text';
      const provider = providerArg || llmConfig.defaultProvider;
      const providerConfig = llmConfig.providers[provider];

      if (!providerConfig || !providerConfig.apiKey) {
        console.error(
          `\n[ERROR] Configuration for provider '${provider}' is missing or incomplete. Check your hardhat.config.ts and .env file.`,
        );
        return;
      }

      let contractPaths: string[];
      const sourcesPath = hre.config.paths.sources;

      if (!contractArg || contractArg.toLowerCase() === 'all') {
        console.log(
          '[INFO] No specific contract provided. Auditing all contracts...',
        );
        contractPaths = await glob(`${sourcesPath}/**/*.{sol,vy}`);
      } else {
        contractPaths = [path.resolve(sourcesPath, contractArg)];
      }

      if (contractPaths.length === 0) {
        console.error('\n[ERROR] No contract files found to audit.');
        return;
      }

      console.log(`[INFO] Found ${contractPaths.length} contract(s) to audit.`);

      const allIssues: any[] = [];
      for (const contractPath of contractPaths) {
        const contractName = path.basename(contractPath);

        const extension = path.extname(contractPath).substring(1); // 'sol' or 'vy'
        let language: SupportedLanguage;

        if (extension === 'sol') {
          language = 'solidity';
        } else if (extension === 'vy') {
          language = 'vyper';
        } else {
          console.warn(
            `[WARN] Unsupported file type ".${extension}" for ${contractName}. Skipping.`,
          );
          continue;
        }

        console.log(`\n---------------------------------------------`);
        console.log(`  Auditing: ${contractName} (${language})`);
        console.log(`---------------------------------------------\n`);

        let contractCode: string;
        try {
          const contractPath = path.resolve(
            hre.config.paths.sources,
            contractName,
          );
          contractCode = fs.readFileSync(contractPath, 'utf8');
          console.log(`[INFO] Successfully read contract: ${contractName}`);
        } catch (error) {
          console.error(
            `\n[ERROR] Could not read contract file: ${contractName}.`,
          );
          continue;
        }

        const prompt = getAuditPrompt(
          contractName,
          contractCode,
          format,
          llmConfig,
          language,
        );

        try {
          console.log(
            `[INFO] Sending code to LLM for analysis (format: ${format})...`,
          );
          const rawAnalysis = await callLLM(provider, providerConfig, prompt);
          console.log(`\n=============================================`);
          console.log(
            `    🤖 LLM Audit Report for ${contractName} (${provider.toUpperCase()})`,
          );
          console.log(`=============================================\n`);
          console.log(rawAnalysis);
          if (format === 'json') {
            const jsonString = extractJson(rawAnalysis);
            try {
              const parsedJson = JSON.parse(jsonString);
              allIssues.push(...parsedJson);
            } catch (e) {
              console.error(
                "\n[ERROR] Failed to parse the JSON extracted from the LLM's response.",
              );
              if (e instanceof SyntaxError) {
                console.error('Syntax Error:', e.message);
              }
              console.error(
                'Extracted string that failed to parse:',
                jsonString,
              );
            }
          }
        } catch (error: any) {
          console.error(
            `\n[ERROR] An error occurred during the audit  of ${contractName}:`,
          );
          console.error(error.message);
        }
      }
      if (format === 'json') {
        if (allIssues.length > 0) {
          const formattedJsonString = JSON.stringify(allIssues, null, 2);
          const outputPath = path.join(
            hre.config.paths.root,
            'audit-report.json',
          );
          fs.writeFileSync(outputPath, formattedJsonString, 'utf8');
          console.log(
            `\n✅ [SUCCESS] Combined audit report for ${contractPaths.length} contract(s) has been saved to: ${outputPath}`,
          );
        } else {
          console.log(
            `\n✅ [SUCCESS] All contracts were audited, and no issues were found.`,
          );
        }
      }
    },
  );
