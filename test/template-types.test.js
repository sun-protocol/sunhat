import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  return result;
}

for (const target of ['evm', 'tron']) {
  test(
    `Hardhat ${target} template passes tsc --noEmit with its declared dependencies`,
    { timeout: 180_000 },
    async (t) => {
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
      const manifest = JSON.parse(
        readFileSync(resolve(project, 'package.json')),
      );
      assert.equal(manifest.devDependencies.sunhat, undefined);
      // Install the framework exactly as generated; no Sunhat override is needed.
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
      assert.equal(existsSync(resolve(project, 'node_modules/sunhat')), false);
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
      if (target === 'evm') {
        await t.test(
          'native build and test scripts run without a local Sunhat package',
          () => {
            run([process.env.npm_execpath, 'run', 'build'], project, 90000);
            const tested = run(
              [process.env.npm_execpath, 'test'],
              project,
              30000,
            );
            assert.match(tested.stdout, /1 passing/u);
          },
        );
      }
      if (target === 'tron') {
        await t.test(
          'the default test task never starts or stops Docker',
          () => {
            const program = `
            const assert = require('node:assert/strict');
            const { basename } = require('node:path');
            const childProcess = require('node:child_process');
            for (const method of ['spawn', 'spawnSync']) {
              const original = childProcess[method];
              childProcess[method] = (command, ...args) => {
                assert.ok(!['docker', 'docker.exe'].includes(basename(String(command))),
                  'the default template must not invoke Docker');
                return original(command, ...args);
              };
            }
            require('ts-node/register');
            const hre = require('hardhat');
            hre.run('test', { noCompile: true, grep: '^$' }).catch((error) => {
              process.stderr.write(String(error) + '\\n');
              process.exitCode = 1;
            });
          `;
            const result = run(['-e', program], project, 30_000);
            assert.match(result.stdout, /0 passing/u);
          },
        );
      }
    },
  );
}
