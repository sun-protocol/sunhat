import path from 'node:path';
import type { NewTaskActionFunction } from 'hardhat/types/tasks';
import { runCompileTask } from '../../build/index.js';
import {
  DeploymentManager,
  discoverDeploymentScripts,
  EvmAdapter,
  loadSnapshotArtifact,
  runDeploymentScripts,
  SunhatDeploymentError,
} from '../../deploy/index.js';
import type {
  DeploymentPlan,
  SunhatDeploymentContext,
} from '../../deploy/index.js';
import {
  createHardhatEvmClient,
  hasHardhatEthers,
} from '../evm-client.js';
import { Hardhat3SolidityBackend } from '../solidity-backend.js';

interface DeployArguments {
  readonly force: boolean;
}

const deployAction: NewTaskActionFunction<DeployArguments> = async (
  arguments_,
  hre
) => {
  const networkName = hre.globalOptions.network;
  if (networkName === undefined) {
    throw new SunhatDeploymentError(
      'INVALID_DEPLOYMENT_PLAN',
      'sunhat deploy requires an explicit --network'
    );
  }
  const boundTargetName = hre.config.sunhat.networks[networkName]?.target;
  const boundTarget =
    boundTargetName === undefined
      ? undefined
      : hre.config.sunhat.compilation.targets[boundTargetName];
  if (boundTarget?.chain === 'tron') {
    throw new SunhatDeploymentError(
      'INVALID_DEPLOYMENT_PLAN',
      'TRON broadcast is disabled until the TVM client passes the release matrix'
    );
  }
  const [build] = await runCompileTask(
    { force: arguments_.force },
    hre,
    new Hardhat3SolidityBackend()
  );
  if (hre.config.sunhat.compilation.targets[build.targetName].chain !== 'evm') {
    throw new SunhatDeploymentError(
      'INVALID_DEPLOYMENT_PLAN',
      'sunhat deploy requires an EVM target in this alpha release'
    );
  }
  const scripts = await discoverDeploymentScripts(hre.config.paths.root);
  if (scripts.length === 0) {
    throw new SunhatDeploymentError(
      'INVALID_DEPLOYMENT_PLAN',
      'no deployment scripts found under deploy/'
    );
  }
  const connection = await hre.network.create(networkName);
  try {
    if (!hasHardhatEthers(connection)) {
      throw new SunhatDeploymentError(
        'INVALID_DEPLOYMENT_PLAN',
        'EVM deployment requires @nomicfoundation/hardhat-ethers in the project plugin list'
      );
    }
    const client = await createHardhatEvmClient(connection, networkName);
    const manager = new DeploymentManager({
      adapter: new EvmAdapter(client),
      outputDirectory: path.resolve(
        hre.config.paths.root,
        hre.config.sunhat.verification.outputDir
      ),
      projectRoot: hre.config.paths.root,
      sourceMode: hre.config.sunhat.verification.sourceMode,
    });
    const context: SunhatDeploymentContext = {
      async deploy(request) {
        const snapshotArtifact = await loadSnapshotArtifact(
          build.snapshotDirectory,
          request.fullyQualifiedName
        );
        const artifact = snapshotArtifact.artifact;
        if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string') {
          throw new SunhatDeploymentError(
            'SNAPSHOT_MISMATCH',
            `artifact is missing ABI or bytecode: ${request.fullyQualifiedName}`
          );
        }
        const constructorArguments = request.constructorArguments ?? [];
        const encodedConstructorArguments = new connection.ethers.Interface(
          artifact.abi
        ).encodeDeploy([...constructorArguments]);
        const plan: DeploymentPlan = {
          buildId: build.buildId,
          confirmations: 1,
          constructorArguments,
          encodedConstructorArguments,
          fullyQualifiedName: request.fullyQualifiedName,
          initCode: `${artifact.bytecode}${encodedConstructorArguments.slice(2)}`,
          projectRoot: hre.config.paths.root,
          snapshotDirectory: build.snapshotDirectory,
          target: build.targetName,
          value: request.value ?? '0',
        };
        const result = await manager.deploy(plan);
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return result;
      },
    };
    await runDeploymentScripts(scripts, context);
  } finally {
    await connection.close();
  }
};

export default deployAction;
