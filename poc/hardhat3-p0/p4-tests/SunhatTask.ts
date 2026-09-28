import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { network } from "hardhat";

describe("Sunhat P4 test task", function () {
  it("uses the target-isolated artifact without invoking a second compiler", async function () {
    const artifact = JSON.parse(
      await readFile(
        path.join(
          process.cwd(),
          "artifacts",
          "sunhat",
          "evm",
          "solidity",
          "p2-contracts",
          "P2Counter.sol",
          "P2Counter.json",
        ),
        "utf8",
      ),
    ) as { abi: unknown[]; bytecode: string };
    const connection = await network.create();
    try {
      const [signer] = await connection.ethers.getSigners();
      const factory = new connection.ethers.ContractFactory(
        artifact.abi,
        artifact.bytecode,
        signer,
      );
      const counter = await factory.deploy(42n);
      await counter.waitForDeployment();
      assert.equal(await counter.initialValue(), 42n);
    } finally {
      await connection.close();
    }
  });
});
