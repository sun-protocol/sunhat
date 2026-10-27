import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { platformKey, releaseFor } from '../dist/toolchain/releases.js';

const cli = fileURLToPath(new URL('../bin/sunhat.js', import.meta.url));

function fixture(t, framework) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'sunhat-json-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    resolve(root, 'sunhat.toml'),
    `[project]\nframework = "${framework}"\ntarget = "evm"\n`,
  );
  return root;
}

function json(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function assertInvalid(result, path) {
  assert.equal(result.status, 3, result.stderr);
  assert.ok(result.stderr.includes(path), result.stderr);
  assert.doesNotMatch(
    result.stderr,
    /Cannot read properties|is not a function|argument must be of type/u,
  );
  assert.equal(result.stdout, '');
}

function lock() {
  return {
    version: 2,
    target: 'evm',
    source: 'fixture/foundry',
    release: 'fixture',
    revision: 'fixture',
    platform: 'fixture',
    binaries: { forge: { path: '.sunhat/forge' } },
  };
}

for (const [name, value] of [
  ['null root', null],
  ['array root', []],
  ['missing binaries', { ...lock(), binaries: undefined }],
  ['null binaries', { ...lock(), binaries: null }],
  ['array binaries', { ...lock(), binaries: [] }],
  ['null binary', { ...lock(), binaries: { forge: null } }],
  ['numeric path', { ...lock(), binaries: { forge: { path: 42 } } }],
  ['empty path', { ...lock(), binaries: { forge: { path: '' } } }],
  ['invalid metadata', { ...lock(), source: 42 }],
  ['invalid schema version', { ...lock(), version: '2' }],
]) {
  test(`Foundry rejects ${name} with a lock-file diagnostic`, (t) => {
    const root = fixture(t, 'foundry');
    const path = resolve(root, '.sunhat/toolchain.json');
    json(path, value);
    for (const args of [['build'], ['toolchain', 'info']]) {
      assertInvalid(run(root, args), path);
    }
  });
}

test('Foundry reports malformed JSON separately from a missing installation', (t) => {
  const root = fixture(t, 'foundry');
  const path = resolve(root, '.sunhat/toolchain.json');
  mkdirSync(dirname(path));
  writeFileSync(path, '{');
  const result = run(root, ['build']);
  assertInvalid(result, path);
  assert.match(result.stderr, /cannot read JSON file/u);
  assert.doesNotMatch(result.stderr, /is not installed/u);
});

function hardhat(t) {
  const root = fixture(t, 'hardhat');
  const project = resolve(root, 'package.json');
  const manifest = resolve(root, 'node_modules/hardhat/package.json');
  json(project, { devDependencies: { hardhat: '2.29.1' } });
  json(manifest, {
    name: 'hardhat',
    version: '2.29.1',
    bin: { hardhat: 'cli.js' },
  });
  writeFileSync(
    resolve(dirname(manifest), 'cli.js'),
    'process.stdout.write(JSON.stringify(process.argv.slice(2)));',
  );
  return { root, project, manifest };
}

for (const [name, value] of [
  ['null root', null],
  ['array root', []],
  ['numeric version', { name: 'hardhat', version: 42 }],
  ['numeric bin', { version: '2.29.1', bin: 42 }],
  ['array bin', { version: '2.29.1', bin: ['cli.js'] }],
  ['numeric bin entry', { version: '2.29.1', bin: { hardhat: 42 } }],
]) {
  test(`Hardhat rejects manifest ${name} with its path`, (t) => {
    const context = hardhat(t);
    json(context.manifest, value);
    assertInvalid(run(context.root, ['compile']), context.manifest);
  });
}

for (const [name, value] of [
  ['null root', null],
  ['array root', []],
  ['null dependencies', { dependencies: null }],
  ['array dependencies', { dependencies: [] }],
  ['numeric dependency', { devDependencies: { hardhat: 42 } }],
]) {
  test(`Hardhat rejects project ${name} with its path`, (t) => {
    const context = hardhat(t);
    json(context.project, value);
    assertInvalid(run(context.root, ['compile']), context.project);
  });
}

for (const name of ['project', 'manifest']) {
  test(`Hardhat reports invalid ${name} JSON with its path`, (t) => {
    const context = hardhat(t);
    writeFileSync(context[name], '{');
    assertInvalid(run(context.root, ['compile']), context[name]);
  });
}

test('Hardhat accepts valid dependency maps and a string bin entry', (t) => {
  const context = hardhat(t);
  json(context.project, { dependencies: { hardhat: '2.29.1' } });
  json(context.manifest, { version: '2.29.1', bin: 'cli.js' });
  const result = run(context.root, ['compile', '--force']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '["compile","--force"]');
});

for (const [name, modify] of [
  [
    'null platforms',
    (value) => {
      value.platforms = null;
    },
  ],
  [
    'array platforms',
    (value) => {
      value.platforms = [];
    },
  ],
  [
    'null artifact',
    (value) => {
      value.platforms[platformKey()] = null;
    },
  ],
  [
    'array artifact',
    (value) => {
      value.platforms[platformKey()] = [];
    },
  ],
  [
    'null tools',
    (value) => {
      value.platforms[platformKey()].tools = null;
    },
  ],
  [
    'array tools',
    (value) => {
      value.platforms[platformKey()].tools = [];
    },
  ],
  [
    'numeric filename',
    (value) => {
      value.platforms[platformKey()].tools.forge = 42;
    },
  ],
]) {
  test(`release configuration rejects ${name} with its path`, (t) => {
    const root = fixture(t, 'foundry');
    const value = JSON.parse(
      readFileSync(
        new URL(
          '../templates/foundry/evm/foundry-toolchain.json',
          import.meta.url,
        ),
      ),
    );
    modify(value);
    const path = resolve(root, 'foundry-toolchain.json');
    json(path, value);
    assert.throws(
      () => releaseFor('evm', root),
      (error) => {
        assert.equal(error.exitCode, 3);
        assert.ok(error.message.includes(path));
        assert.match(error.message, /invalid Foundry toolchain configuration/u);
        return true;
      },
    );
  });
}
