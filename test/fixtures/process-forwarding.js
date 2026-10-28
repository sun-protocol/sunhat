import { spawnNative } from '../../dist/process.js';

const status = await spawnNative(
  process.execPath,
  [
    '-e',
    'setTimeout(() => process.exit(99), 5000); process.stdout.write("ready\\n");',
  ],
  process.cwd(),
);
process.stdout.write(`exit-code=${status}\n`);
process.exitCode = status;
