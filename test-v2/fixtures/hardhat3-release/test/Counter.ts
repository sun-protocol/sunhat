import assert from 'node:assert/strict';
import { network } from 'hardhat';

describe('release package Counter', function () {
  it('runs against an explicit Hardhat 3 connection', async function () {
    const connection = await network.create();
    try {
      const counter = await connection.ethers.deployContract('Counter', [41n]);
      await counter.waitForDeployment();
      const transaction = await counter.increment();
      await transaction.wait();
      assert.equal(await counter.value(), 42n);
    } finally {
      await connection.close();
    }
  });
});
