import assert from 'node:assert/strict';
import type { ContractTransactionReceipt } from 'ethers';
import { network } from 'hardhat';

describe('Counter', function () {
  it('deploys, changes state, and records the transaction event', async function () {
    const connection = await network.create();
    try {
      const counter = await connection.ethers.deployContract('Counter');
      await counter.waitForDeployment();
      assert.equal(await counter.number(), 0n);
      const receipt: ContractTransactionReceipt | null = await (
        await counter.increment()
      ).wait();
      assert.equal(receipt?.status, 1);
      assert.equal(await counter.number(), 1n);
      const event = receipt?.logs
        .map((log) => counter.interface.parseLog(log))
        .find((log) => log?.name === 'NumberChanged');
      assert.ok(event);
      assert.equal(event.args[0], 0n);
      assert.equal(event.args[1], 1n);
    } finally {
      await connection.close();
    }
  });
});
