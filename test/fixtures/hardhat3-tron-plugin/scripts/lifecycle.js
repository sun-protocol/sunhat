import assert from 'node:assert/strict';
import { network } from 'hardhat';

const connections = [];
let primary;
let succeeded = false;
try {
  const first = await network.create('tre');
  connections.push(first);
  const second = await network.create('tre');
  connections.push(second);
  assert.ok(first.tre && second.tre);
  await first.close();
  connections.shift();
  assert.ok((await second.ethers.provider.getBlockNumber()) > 0);
  console.log('TRE_LEASE_STILL_READY');
  succeeded = true;
} catch (error) {
  primary = error;
}
const failures = [];
for (const connection of connections) {
  try {
    await connection.close();
  } catch (error) {
    failures.push(error);
  }
}
if (!succeeded) {
  for (const failure of failures) {
    console.error('TRON cleanup failed:', failure);
  }
  throw primary;
}
if (failures.length) {
  throw new AggregateError(failures, 'TRON lease cleanup failed');
}
