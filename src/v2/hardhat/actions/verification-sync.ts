import path from 'node:path';
import type { NewTaskActionFunction } from 'hardhat/types/tasks';
import {
  DeploymentManager,
  EvmAdapter,
  SunhatDeploymentError,
} from '../../deploy/index.js';
import {
  createHardhatEvmClient,
  hasHardhatEthers,
} from '../evm-client.js';

interface SyncArguments {
  readonly tx?: string;
}

const syncAction: NewTaskActionFunction<SyncArguments> = async ({ tx }, hre) => {
  if (tx === undefined || !tx.trim()) {
    throw new SunhatDeploymentError(
      'INVALID_DEPLOYMENT_PLAN',
      'verification sync requires --tx <transactionId>'
    );
  }
  const networkName = hre.globalOptions.network;
  if (networkName === undefined) {
    throw new SunhatDeploymentError(
      'INVALID_DEPLOYMENT_PLAN',
      'verification sync requires an explicit --network'
    );
  }
  const binding = hre.config.sunhat.networks[networkName];
  const target =
    binding?.target === undefined
      ? undefined
      : hre.config.sunhat.compilation.targets[binding.target];
  if (target?.chain !== 'evm') {
    throw new SunhatDeploymentError(
      'INVALID_DEPLOYMENT_PLAN',
      'TRON verification sync is disabled until the TVM client passes the release matrix'
    );
  }
  const connection = await hre.network.create(networkName);
  try {
    if (!hasHardhatEthers(connection)) {
      throw new SunhatDeploymentError(
        'INVALID_DEPLOYMENT_PLAN',
        'EVM verification sync requires @nomicfoundation/hardhat-ethers in the project plugin list'
      );
    }
    const manager = new DeploymentManager({
      adapter: new EvmAdapter(
        await createHardhatEvmClient(connection, networkName)
      ),
      outputDirectory: path.resolve(
        hre.config.paths.root,
        hre.config.sunhat.verification.outputDir
      ),
      projectRoot: hre.config.paths.root,
      sourceMode: hre.config.sunhat.verification.sourceMode,
    });
    const result = await manager.syncByTransactionId(tx);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await connection.close();
  }
};

export default syncAction;
