import path from "node:path";
import type { NewTaskActionFunction } from "hardhat/types/tasks";
import {
  DeploymentManager,
  discoverDeploymentScripts,
  EvmAdapter,
  loadSnapshotArtifact,
  runDeploymentScripts,
  SunhatDeploymentError,
} from "../../../src/v2/deploy/index.js";
import type {
  DeploymentPlan,
  DeploymentResult,
} from "../../../src/v2/deploy/index.js";
import { runCompileTask } from "../../../src/v2/build/index.js";
import { Hardhat3SolidityBackend } from "./p2-hardhat-backend.js";
import { createP4EvmClient } from "./p4-evm-client.js";

interface DeployArguments {
  readonly force: boolean;
}

export interface P4DeploymentRequest {
  readonly constructorArguments?: readonly unknown[];
  readonly fullyQualifiedName: string;
  readonly value?: string;
}

export interface P4DeploymentContext {
  deploy(request: P4DeploymentRequest): Promise<DeploymentResult>;
}

const deployAction: NewTaskActionFunction<DeployArguments> = async (
  arguments_,
  hre,
) => {
  const networkName = hre.globalOptions.network;
  if (networkName === undefined) {
    throw new SunhatDeploymentError(
      "INVALID_DEPLOYMENT_PLAN",
      "sunhat deploy requires an explicit --network",
    );
  }
  const [build] = await runCompileTask(
    { force: arguments_.force },
    hre,
    new Hardhat3SolidityBackend(),
  );
  if (hre.config.sunhat.compilation.targets[build.targetName].chain !== "evm") {
    throw new SunhatDeploymentError(
      "INVALID_DEPLOYMENT_PLAN",
      "the P4 POC task only enables EVM broadcast; TRON requires the unverified TVM client",
    );
  }
  const scripts = await discoverDeploymentScripts(hre.config.paths.root);
  if (scripts.length === 0) {
    throw new SunhatDeploymentError(
      "INVALID_DEPLOYMENT_PLAN",
      "no deployment scripts found under deploy/",
    );
  }
  const connection = await hre.network.create(networkName);
  try {
    const client = await createP4EvmClient(connection, networkName);
    const manager = new DeploymentManager({
      adapter: new EvmAdapter(client),
      outputDirectory: path.resolve(
        hre.config.paths.root,
        hre.config.sunhat.verification.outputDir,
      ),
      projectRoot: hre.config.paths.root,
      sourceMode: hre.config.sunhat.verification.sourceMode,
    });
    const context: P4DeploymentContext = {
      async deploy(request) {
        const snapshotArtifact = await loadSnapshotArtifact(
          build.snapshotDirectory,
          request.fullyQualifiedName,
        );
        const artifact = snapshotArtifact.artifact;
        if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== "string") {
          throw new SunhatDeploymentError(
            "SNAPSHOT_MISMATCH",
            `artifact is missing ABI or bytecode: ${request.fullyQualifiedName}`,
          );
        }
        const constructorArguments = request.constructorArguments ?? [];
        const encodedConstructorArguments = new connection.ethers.Interface(
          artifact.abi,
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
          value: request.value ?? "0",
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
