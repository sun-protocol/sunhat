import assert from 'node:assert/strict';
import { withConnection } from '../helpers/connection.js';

const original = new Error('EXPECTED_PRIMARY_FAILURE');
await assert.rejects(
  withConnection(async () => {
    throw original;
  }),
  (error: unknown) => error === original,
);

for (const original of [undefined, null, false]) {
  let caught: unknown = Symbol('not rejected');
  try {
    await withConnection(async () => {
      throw original;
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, original);
}

const report = console.error;
try {
  console.error = () => {
    throw new Error('EXPECTED_REPORTING_FAILURE');
  };
  await assert.rejects(
    withConnection(async () => {
      throw original;
    }),
    (error: unknown) => error === original,
  );
} finally {
  console.error = report;
}

await assert.rejects(
  withConnection(async () => 'completed'),
  /EXPECTED_CLOSE_FAILURE/u,
);
console.log('Original errors preserved; cleanup-only failure propagated');
