import assert from "node:assert/strict";
import { network } from "hardhat";

describe("Hardhat 3 explicit network connections", function () {
  it("deploys and mutates a contract through ethers v6", async function () {
    const firstConnection = await network.create();

    try {
      const counter = await firstConnection.ethers.deployContract("Counter");
      await counter.waitForDeployment();

      const transaction = await counter.increment();
      await transaction.wait();

      assert.equal(await counter.value(), 1n);
    } finally {
      await firstConnection.close();
    }
  });

  it("isolates state between independent network connections", async function () {
    const firstConnection = await network.create();
    const secondConnection = await network.create();

    try {
      const firstCounter = await firstConnection.ethers.deployContract("Counter");
      const secondCounter = await secondConnection.ethers.deployContract("Counter");
      await Promise.all([
        firstCounter.waitForDeployment(),
        secondCounter.waitForDeployment(),
      ]);

      const transaction = await firstCounter.increment();
      await transaction.wait();

      firstConnection.sunhatProbe.counter = 7;

      assert.equal(await firstCounter.value(), 1n);
      assert.equal(await secondCounter.value(), 0n);
      assert.notEqual(
        firstConnection.sunhatProbe,
        secondConnection.sunhatProbe,
      );
      assert.equal(firstConnection.sunhatProbe.connectionId, firstConnection.id);
      assert.equal(secondConnection.sunhatProbe.connectionId, secondConnection.id);
      assert.equal(firstConnection.sunhatProbe.counter, 7);
      assert.equal(secondConnection.sunhatProbe.counter, 0);
    } finally {
      await Promise.all([firstConnection.close(), secondConnection.close()]);
    }
  });
});
