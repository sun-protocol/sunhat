import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { network } from "hardhat";
import {
  commitBuildSnapshot,
  sha256,
} from "../../../src/v2/build/index.js";
import { normalizeSunhatConfig } from "../../../src/v2/config/index.js";
import {
  DeploymentManager,
  EvmAdapter,
} from "../../../src/v2/deploy/index.js";
import type {
  DeploymentPlan,
  DeploymentReceipt,
} from "../../../src/v2/deploy/index.js";

describe("Sunhat P3 local EVM deployment", function () {
  it("broadcasts through an explicit Hardhat 3 connection and archives the receipt", async function () {
    this.timeout(15_000);
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "sunhat-p3-edr-"));
    let connection: Awaited<ReturnType<typeof network.create>> | undefined;
    try {
      await mkdir(path.join(projectRoot, "contracts"), { recursive: true });
      await writeFile(
        path.join(projectRoot, "package.json"),
        '{"name":"sunhat-p3-edr-fixture","private":true,"type":"module"}\n',
      );
      const target = normalizeSunhatConfig({
        compilation: {
          targets: {
            evm: {
              chain: "evm",
              compilers: [
                { id: "solc", kind: "solc", version: "0.8.25" },
              ],
              sources: ["contracts"],
            },
          },
        },
      }).compilation.targets.evm;
      const artifactDirectory = path.join(projectRoot, "compiled-artifacts");
      await mkdir(
        path.join(artifactDirectory, "solidity", "contracts", "Counter.sol"),
        { recursive: true },
      );
      await cp(
        path.join(process.cwd(), "artifacts", "contracts", "Counter.sol", "Counter.json"),
        path.join(
          artifactDirectory,
          "solidity",
          "contracts",
          "Counter.sol",
          "Counter.json",
        ),
      );
      await cp(
        path.join(process.cwd(), "artifacts", "build-info"),
        path.join(artifactDirectory, "solidity", "build-info"),
        { recursive: true },
      );
      const sourceContent = await readFile(
        path.join(process.cwd(), "contracts", "Counter.sol"),
        "utf8",
      );
      await writeFile(
        path.join(projectRoot, "contracts", "Counter.sol"),
        sourceContent,
      );
      const buildId = sha256(`p3-edr:${sha256(sourceContent)}`);
      const snapshotDirectory = await commitBuildSnapshot({
        artifactDirectory,
        buildId,
        metadata: { adapter: "hardhat-3", compilerVersion: "0.8.25" },
        projectRoot,
        sources: [
          {
            absolutePath: path.join(projectRoot, "contracts", "Counter.sol"),
            content: sourceContent,
            language: "solidity",
            sha256: sha256(sourceContent),
            sourceName: "contracts/Counter.sol",
          },
        ],
        target,
        targetName: "evm",
      });
      const artifact = JSON.parse(
        await readFile(
          path.join(
            snapshotDirectory,
            "artifacts",
            "solidity",
            "contracts",
            "Counter.sol",
            "Counter.json",
          ),
          "utf8",
        ),
      ) as { bytecode: string };
      connection = await network.create();
      const activeConnection = connection;
      const provider = activeConnection.ethers.provider;
      const [signer] = await activeConnection.ethers.getSigners();
      const from = await signer.getAddress();
      const client = {
        async getNetworkIdentity() {
          const [chain, genesis] = await Promise.all([
            provider.getNetwork(),
            provider.getBlock(0),
          ]);
          assert.ok(genesis?.hash);
          return {
            chainId: chain.chainId.toString(),
            genesisHash: genesis.hash,
            instanceId: activeConnection.id,
            name: "hardhat-edr",
          };
        },
        async prepareDeployment(plan: DeploymentPlan) {
          const nonce = await signer.getNonce("pending");
          return {
            data: plan.initCode,
            from,
            method: "create" as const,
            nonce: nonce.toString(),
            recoveryId: `${from}:${nonce}`,
            value: plan.value ?? "0",
          };
        },
        async broadcast(transaction: {
          readonly data: string;
          readonly value: string;
        }) {
          const sent = await signer.sendTransaction({
            data: transaction.data,
            value: BigInt(transaction.value),
          });
          return { transactionId: sent.hash };
        },
        async getReceipt(
          transactionId: string,
          confirmations: number,
        ): Promise<DeploymentReceipt> {
          const receipt = await provider.getTransactionReceipt(transactionId);
          assert.ok(receipt);
          return {
            address: receipt.contractAddress ?? undefined,
            blockHash: receipt.blockHash,
            blockNumber: receipt.blockNumber.toString(),
            confirmations,
            raw: {
              blockHash: receipt.blockHash,
              blockNumber: receipt.blockNumber.toString(),
              gasUsed: receipt.gasUsed.toString(),
              transactionHash: receipt.hash,
            },
            status: receipt.status === 1 ? "success" : "failure",
            transactionId,
          };
        },
        async getCode(address: string) {
          return provider.getCode(address);
        },
      };
      const plan: DeploymentPlan = {
        buildId,
        confirmations: 1,
        constructorArguments: [],
        encodedConstructorArguments: "0x",
        fullyQualifiedName:
          "contracts/Counter.sol:Counter",
        initCode: artifact.bytecode,
        projectRoot,
        snapshotDirectory,
        target: "evm",
        value: "0",
      };
      const result = await new DeploymentManager({
        adapter: new EvmAdapter(client),
        projectRoot,
      }).deploy(plan);

      assert.equal(result.runtimeMatch.status, "exact");
      assert.match(result.address, /^0x[a-fA-F0-9]{40}$/);
      assert.equal(
        JSON.parse(
          await readFile(
            path.join(result.verificationDirectory, "manifest.json"),
            "utf8",
          ),
        ).archiveState,
        "complete",
      );
    } finally {
      await connection?.close();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
