import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(
  readFileSync(resolve(repository, 'package.json'), 'utf8'),
);

function run(args, cwd, timeout = 30_000) {
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

test(
  'the packed Hardhat 3 EVM template installs, typechecks, builds, tests and deploys',
  { timeout: 180_000 },
  (t) => {
    const npm = process.env.npm_execpath;
    assert.ok(npm, 'Run this integration suite with npm run test:hardhat3');
    const temporary = mkdtempSync(
      resolve(tmpdir(), 'sunhat-hardhat3-integration-'),
    );
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const archives = resolve(temporary, 'archives');
    mkdirSync(archives);
    // The npm script has built dist; avoid rebuilding it during artifact inspection.
    const packed = run(
      [
        npm,
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        archives,
      ],
      repository,
    );
    const packages = JSON.parse(packed.stdout);
    assert.equal(packages.length, 1);
    const archive = resolve(archives, packages[0].filename);
    const consumer = resolve(temporary, 'consumer');
    mkdirSync(consumer);
    run(
      [
        npm,
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        '--prefix',
        consumer,
        archive,
      ],
      temporary,
      90_000,
    );
    const cli = resolve(
      consumer,
      'node_modules',
      metadata.name,
      'bin/sunhat.js',
    );
    const project = resolve(temporary, 'project with spaces');
    run(
      [
        cli,
        'init',
        '--framework',
        'hardhat',
        '--hardhat-version',
        '3',
        '--target',
        'evm',
        project,
      ],
      temporary,
    );
    const generated = JSON.parse(
      readFileSync(resolve(project, 'package.json'), 'utf8'),
    );
    assert.equal(
      generated.devDependencies.sunhat,
      `npm:${metadata.name}@${metadata.version}`,
    );
    assert.equal(generated.devDependencies.hardhat, '3.21.1');
    // Exercise the local artifact under development rather than the registry's
    // released CLI, leaving every framework dependency exactly as generated.
    run(
      [
        npm,
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--save-dev',
        `sunhat@file:${archive}`,
      ],
      project,
      90_000,
    );
    run(
      [resolve(project, 'node_modules/typescript/bin/tsc'), '--noEmit'],
      project,
    );
    const built = run([npm, 'run', 'build'], project);
    assert.match(
      built.stdout,
      /Compiled 1 Solidity file|No contracts to compile/u,
    );
    const tested = run([npm, 'test'], project);
    assert.match(tested.stdout, /1 passing/u);
    assert.match(
      tested.stdout,
      /deploys, changes state, and records the transaction event/u,
    );
    const deployed = run([cli, 'run', 'scripts/deploy.ts'], project);
    assert.match(deployed.stdout, /0x[a-fA-F0-9]{40}/u);
  },
);
