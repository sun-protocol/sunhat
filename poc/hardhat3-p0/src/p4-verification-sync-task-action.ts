import path from "node:path";
import type { NewTaskActionFunction } from "hardhat/types/tasks";
import {
  DeploymentManager,
  EvmAdapter,
  SunhatDeploymentError,
} from "../../../src/v2/deploy/index.js";
import { createP4EvmClient } from "./p4-evm-client.js";

interface SyncArguments {
  readonly tx?: string;
}

const syncAction: NewTaskActionFunction<SyncArguments> = async (
  { tx },
  hre,
) => {
  if (tx === undefined || !tx.trim()) {
    throw new SunhatDeploymentError(
      "INVALID_DEPLOYMENT_PLAN",
      "verification sync requires --tx <transactionId>",
    );
  }
  const networkName = hre.globalOptions.network;
  if (networkName === undefined) {
    throw new SunhatDeploymentError(
      "INVALID_DEPLOYMENT_PLAN",
      "verification sync requires an explicit --network",
    );
  }
  const binding = hre.config.sunhat.networks[networkName];
  const target = binding?.target === undefined
    ? undefined
    : hre.config.sunhat.compilation.targets[binding.target];
  if (target?.chain !== "evm") {
    throw new SunhatDeploymentError(
      "INVALID_DEPLOYMENT_PLAN",
      "the P4 POC sync task only enables EVM networks",
    );
  }
  const connection = await hre.network.create(networkName);
  try {
    const manager = new DeploymentManager({
      adapter: new EvmAdapter(
        await createP4EvmClient(connection, networkName),
      ),
      outputDirectory: path.resolve(
        hre.config.paths.root,
        hre.config.sunhat.verification.outputDir,
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
