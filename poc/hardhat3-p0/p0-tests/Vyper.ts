import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { network } from "hardhat";

describe("Vyper 0.4.3 artifact", function () {
  it("deploys and executes through the Hardhat 3 EVM connection", async function () {
    const artifact = JSON.parse(
      await readFile(
        path.resolve(
          "artifacts-vyper/contracts/Depositer.vy/Depositer.json",
        ),
        "utf8",
      ),
    );
    assert.equal(artifact._format, "sunhat-vyper-artifact-1");

    const connection = await network.create();
    try {
      const [deployer] = await connection.ethers.getSigners();
      const factory = new connection.ethers.ContractFactory(
        artifact.abi,
        artifact.bytecode,
        deployer,
      );
      const contract = await factory.deploy(41n);
      await contract.waitForDeployment();

      assert.equal(
        await contract.getFunction("stored_value").staticCall(),
        41n,
      );
      const transaction = await contract.getFunction("set_value").send(42n);
      await transaction.wait();
      assert.equal(
        await contract.getFunction("stored_value").staticCall(),
        42n,
      );
    } finally {
      await connection.close();
    }
  });
});
