import assert from 'node:assert/strict';
import { network } from 'hardhat';

const { taskContext } = await import(
  new URL(
    './dist/plugins/tron/resources.js',
    import.meta.resolve('sunhat/package.json'),
  )
);
const connections = [];
let primary;
let succeeded = false;
try {
  const first = await taskContext.run('test', () => network.create('tre'));
  connections.push(first);
  const second = await network.create('alias');
  connections.push(second);
  assert.ok(first.tre && second.tre);
  const identity = await first.tre.instanceId();
  assert.equal(await first.tre.instanceId(), identity);
  assert.equal(await second.tre.instanceId(), identity);
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
