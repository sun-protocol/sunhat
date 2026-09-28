#!/usr/bin/env node

import assert from 'node:assert/strict';
import { chmod, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const executablePath = fileURLToPath(
  new URL('../dist/cli/bin.js', import.meta.url)
);
const source = await readFile(executablePath, 'utf8');
assert.ok(
  source.startsWith('#!/usr/bin/env node\n'),
  'compiled Sunhat CLI is missing its Node.js shebang'
);
await chmod(executablePath, 0o755);
