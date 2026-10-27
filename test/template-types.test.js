import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const cli = resolve(repository, 'bin/sunhat.js');

function run(args, cwd, timeout = 10_000) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    [result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n'),
  );
}

for (const target of ['evm', 'tron']) {
  test(
    `Hardhat ${target} template passes tsc --noEmit with its declared dependencies`,
    { timeout: 180_000 },
    (t) => {
      assert.ok(
        process.env.npm_execpath,
        'Run this integration suite with npm run test:templates',
      );
      const temporary = mkdtempSync(
        resolve(tmpdir(), `sunhat-template-types-${target}-`),
      );
      t.after(() => rmSync(temporary, { recursive: true, force: true }));
      const project = resolve(temporary, 'project with spaces');
      run(
        [cli, 'init', '--framework', 'hardhat', '--target', target, project],
        temporary,
      );
      // Use the generated package as-is, including its exact dependency versions.
      run(
        [
          process.env.npm_execpath,
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
        ],
        project,
        150_000,
      );
      const config = JSON.parse(
        readFileSync(resolve(project, 'tsconfig.json'), 'utf8'),
      );
      assert.notEqual(
        config.compilerOptions.skipLibCheck,
        true,
        'Template type checks must include dependency declarations',
      );
      run(
        [resolve(project, 'node_modules/typescript/bin/tsc'), '--noEmit'],
        project,
        30_000,
      );
    },
  );
}
