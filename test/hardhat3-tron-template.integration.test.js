import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { image, privateKey, run, waitForNode } from './helpers/tre.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(readFileSync(resolve(repository, 'package.json')));

test(
  'the packed Hardhat 3 TRON template typechecks, builds, tests, deploys and adopts',
  { timeout: 240000 },
  async (t) => {
    const npm = process.env.npm_execpath;
    assert.ok(npm, 'Run with npm run test:hardhat3:tron-template');
    const temporary = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-template-'));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const archives = resolve(temporary, 'archives');
    mkdirSync(archives);
    const packed = JSON.parse(
      run(process.execPath, [
        npm,
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        archives,
      ]).stdout,
    );
    assert.ok(
      packed[0].files.some(({ path }) => path === 'dist/plugins/tron/index.js'),
    );
    assert.ok(
      !packed[0].files.some(({ path }) => /\.(?:java|jar)$/.test(path)),
    );
    const archive = resolve(archives, packed[0].filename);
    const consumer = resolve(temporary, 'consumer');
    mkdirSync(consumer);
    run(
      process.execPath,
      [
        npm,
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--prefix',
        consumer,
        archive,
      ],
      { timeout: 120000 },
    );
    const cli = resolve(
      consumer,
      'node_modules',
      metadata.name,
      'bin/sunhat.js',
    );
    const project = resolve(temporary, 'TRON project with spaces');
    run(process.execPath, [
      cli,
      'init',
      '--framework',
      'hardhat',
      '--hardhat-version',
      '3',
      '--target',
      'tron',
      project,
    ]);
    const generated = JSON.parse(
      readFileSync(resolve(project, 'package.json')),
    );
    assert.equal(
      generated.devDependencies.sunhat,
      `npm:${metadata.name}@${metadata.version}`,
    );
    assert.equal(
      generated.devDependencies['@openzeppelin/hardhat-tron'],
      undefined,
    );
    run(
      process.execPath,
      [
        npm,
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--save-dev',
        `sunhat@file:${archive}`,
      ],
      { cwd: project, timeout: 120000 },
    );
    const installedCli = resolve(project, 'node_modules/sunhat/bin/sunhat.js');
    const name = `sunhat-tron-template-${randomUUID()}`;
    t.after(() => {
      const result = spawnSync('docker', ['rm', '-f', name], {
        encoding: 'utf8',
        timeout: 30000,
      });
      assert.ok(
        result.status === 0 || result.stderr?.includes('No such container'),
        result.error?.message ?? result.stderr,
      );
    });
    run(
      'docker',
      [
        'run',
        '-d',
        '--name',
        name,
        '-p',
        '127.0.0.1::9090',
        '-e',
        'accounts=10',
        '-e',
        'defaultBalance=1000000000',
        '-e',
        'mnemonic=test test test test test test test test test test test junk',
        '-e',
        "hdPath=m/44'/60'/0'/0",
        image,
      ],
      { timeout: 90000 },
    );
    const bindings = JSON.parse(
      run('docker', [
        'inspect',
        '--format',
        '{{json .NetworkSettings.Ports}}',
        name,
      ]).stdout,
    );
    const url = `http://127.0.0.1:${bindings['9090/tcp'][0].HostPort}`;
    await waitForNode(url);
    const options = {
      cwd: project,
      timeout: 90000,
      env: {
        ...process.env,
        TRE_URL: url,
        TRE_PRIVATE_KEY: '0x' + privateKey,
        TRON_SOLC_PATH: process.env.SUNHAT_TRON_SOLC,
      },
    };
    const checked = JSON.parse(readFileSync(resolve(project, 'tsconfig.json')));
    assert.notEqual(checked.compilerOptions.skipLibCheck, true);
    run(
      process.execPath,
      [resolve(project, 'node_modules/typescript/bin/tsc'), '--noEmit'],
      options,
    );
    run(process.execPath, [npm, 'run', 'build'], options);
    const tested = run(process.execPath, [npm, 'test'], options);
    assert.match(tested.stdout, /1 passing/);
    const deployed = run(
      process.execPath,
      [
        installedCli,
        'run',
        'scripts/deploy.ts',
        '--network',
        'tre',
        '--no-compile',
      ],
      options,
    );
    assert.match(deployed.stdout, /0x[0-9a-fA-F]{40}/);
    assert.equal(
      run('docker', [
        'inspect',
        '--format',
        '{{.State.Running}}',
        name,
      ]).stdout.trim(),
      'true',
    );
    writeFileSync(
      resolve(project, 'wrong.config.ts'),
      `import base from './hardhat.config.js';\nexport default { ...base, networks: { ...base.networks, evm: { type: 'edr-simulated' } } };\n`,
    );
    const rejected = spawnSync(
      process.execPath,
      [
        installedCli,
        'run',
        'scripts/deploy.ts',
        '--config',
        'wrong.config.ts',
        '--network',
        'evm',
        '--no-compile',
      ],
      { ...options, encoding: 'utf8' },
    );
    assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
    assert.match(rejected.stderr, /requires a TRON connection/);
    const configBefore = readFileSync(
      resolve(project, 'hardhat.config.ts'),
      'utf8',
    );
    const packageBefore = readFileSync(
      resolve(project, 'package.json'),
      'utf8',
    );
    rmSync(resolve(project, 'sunhat.toml'));
    run(
      process.execPath,
      [
        installedCli,
        'init',
        '--adopt',
        '--framework',
        'hardhat',
        '--hardhat-version',
        '3',
        '--target',
        'tron',
        project,
      ],
      options,
    );
    assert.equal(
      readFileSync(resolve(project, 'hardhat.config.ts'), 'utf8'),
      configBefore,
    );
    assert.equal(
      readFileSync(resolve(project, 'package.json'), 'utf8'),
      packageBefore,
    );
    assert.match(
      readFileSync(resolve(project, 'sunhat.toml'), 'utf8'),
      /target = "tron"/,
    );
  },
);
