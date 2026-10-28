import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import {
  configureFoundryTemplates,
  foundryInitArgs,
  foundryInitEnv,
} from './fixtures/foundry-init.js';
import { copyCliRuntime } from './fixtures/runtime.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const packageMetadata = JSON.parse(
  readFileSync(resolve(repository, 'package.json'), 'utf8'),
);
const temporary = mkdtempSync(resolve(tmpdir(), 'sunhat-cli-'));
after(() => rmSync(temporary, { recursive: true, force: true }));
const { packageRoot, cli } = copyCliRuntime(resolve(temporary, 'runtime'));
configureFoundryTemplates(packageRoot);

function temp(name) {
  return mkdtempSync(resolve(temporary, `${name}-`));
}

function run(cwd, args) {
  return spawnSync(
    process.execPath,
    [...(args[0] === 'init' ? foundryInitArgs : []), cli, ...args],
    {
      cwd,
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, ...foundryInitEnv },
    },
  );
}

function json(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function binding(root, framework, target) {
  writeFileSync(
    resolve(root, 'sunhat.toml'),
    `[project]\nframework = "${framework}"\ntarget = "${target}"\n`,
  );
  json(resolve(root, 'package.json'), {
    private: true,
    devDependencies: framework === 'hardhat' ? { hardhat: '2.22.0' } : {},
  });
}

function executable(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(path, 0o755);
}

function hardhat(root, version = '2.22.0') {
  const base = resolve(root, 'node_modules/hardhat');
  json(resolve(base, 'package.json'), {
    name: 'hardhat',
    version,
    bin: { hardhat: 'cli.js' },
  });
  executable(
    resolve(base, 'cli.js'),
    `process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exitCode = 17;`,
  );
}

function foundry(root, target) {
  const base = resolve(root, `.sunhat/toolchains/${target}`);
  const binaries = {};
  for (const tool of ['forge', 'cast', 'anvil', 'chisel']) {
    const path = resolve(base, tool);
    executable(
      path,
      `process.stdout.write('${tool}:'+JSON.stringify(process.argv.slice(2)));`,
    );
    binaries[tool] = {
      path: `.sunhat/toolchains/${target}/${tool}`,
    };
  }
  json(resolve(root, '.sunhat/toolchain.json'), {
    version: 2,
    target,
    source: target === 'evm' ? 'foundry-rs/foundry' : 'elsvv/foundry-tron',
    release: target === 'evm' ? 'v1.8.6' : 'foundry-tron-latest',
    revision:
      target === 'evm' ? 'v1.8.6' : '9ea07db4b342fd606f6f7c3f99be1757e90d5e90',
    platform: 'test',
    binaries,
  });
}

test('init defaults to Foundry and TRON', () => {
  const root = temp('default-foundry');
  const result = run(dirname(root), ['init', root]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(resolve(root, 'sunhat.toml'), 'utf8'),
    /framework = "foundry"/u,
  );
  assert.match(
    readFileSync(resolve(root, 'sunhat.toml'), 'utf8'),
    /target = "tron"/u,
  );
  assert.match(
    readFileSync(resolve(root, 'foundry.toml'), 'utf8'),
    /network = "tron"/u,
  );
  assert.equal(
    JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts
      .build,
    'sunhat build',
  );
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  assert.match(readme, /Foundry TRON Project with Sunhat/u);
  const build = run(root, ['build']);
  assert.equal(build.status, 0, build.stderr);
  assert.equal(build.stdout, '["build"]');
});
test('init accepts an explicit Foundry EVM target', () => {
  const root = temp('explicit-foundry');
  const result = run(dirname(root), [
    'init',
    '--framework',
    'foundry',
    '--target',
    'evm',
    root,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(resolve(root, 'sunhat.toml'), 'utf8'),
    /framework = "foundry"/u,
  );
  assert.match(
    readFileSync(resolve(root, 'sunhat.toml'), 'utf8'),
    /target = "evm"/u,
  );
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  assert.match(readme, /Foundry EVM Project with Sunhat/u);
  assert.doesNotMatch(readme, /network = "tron"/u);
  const build = run(root, ['build']);
  assert.equal(build.status, 0, build.stderr);
  assert.equal(build.stdout, '["build"]');
});
test('Hardhat scaffold requires explicit framework and refuses overwrite', () => {
  const root = temp('init');
  const result = run(dirname(root), [
    'init',
    '--framework',
    'hardhat',
    '--target',
    'evm',
    root,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(resolve(root, 'sunhat.toml'), 'utf8'),
    /framework = "hardhat"/u,
  );
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  assert.doesNotMatch(JSON.stringify(pkg), /hardhat-tron/u);
  assert.equal(
    pkg.devDependencies.sunhat,
    `npm:${packageMetadata.name}@${packageMetadata.version}`,
  );
  assert.equal(pkg.scripts.build, 'sunhat compile');
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  assert.match(readme, /Hardhat EVM Project with Sunhat/u);
  assert.doesNotMatch(readme, /TRE_URL/u);
  assert.equal(
    run(dirname(root), [
      'init',
      '--framework',
      'hardhat',
      '--target',
      'evm',
      root,
    ]).status,
    2,
  );
});
test('TRON Hardhat scaffold selects TRE and loads its ethers bridge last', () => {
  const root = temp('hardhat-tron');
  const result = run(dirname(root), ['init', '--framework', 'hardhat', root]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(resolve(root, 'sunhat.toml'), 'utf8'),
    /target = "tron"/u,
  );
  const config = readFileSync(resolve(root, 'hardhat.config.ts'), 'utf8');
  assert.ok(
    config.indexOf('@nomicfoundation/hardhat-ethers') <
      config.indexOf('@openzeppelin/hardhat-tron'),
  );
  assert.match(config, /defaultNetwork: ['"]tre['"]/u);
  assert.match(config, /tron: true/u);
  assert.match(config, /compiler: \{ target: ['"]tron['"] \}/u);
  assert.match(config, /0x0{63}1/u);
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  assert.match(readme, /Hardhat TRON Project with Sunhat/u);
  assert.match(readme, /TRE_URL/u);
});
test('init rejects an invalid framework', () => {
  const result = run(temp('framework'), [
    'init',
    '--framework',
    'unknown',
    '--target',
    'evm',
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /framework requires foundry or hardhat/u);
});
for (const option of ['--help', '-h']) {
  test(`init ${option} reports the TRON target default`, () => {
    const result = run(temp('help'), ['init', option]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /target=tron/u);
  });
}
test('init accepts equals options after the project path', () => {
  const root = temp('equals-init');
  const result = run(dirname(root), [
    'init',
    root,
    '--framework=hardhat',
    '--target=evm',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(resolve(root, 'sunhat.toml'), 'utf8'),
    /framework = "hardhat"\ntarget = "evm"/u,
  );
});
test('init accepts a dash-prefixed project path after the option terminator', () => {
  const root = temp('terminator-init');
  const result = run(root, ['init', '--', '-project']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(resolve(root, '-project/sunhat.toml'), 'utf8'),
    /framework = "foundry"\ntarget = "tron"/u,
  );
});
for (const [name, args] of [
  ['unknown long option', ['--unknown']],
  ['unknown short option', ['-x']],
  ['missing framework value', ['--framework']],
  ['missing target value', ['--target']],
  ['ambiguous target value', ['--target', '--adopt']],
  ['invalid boolean value', ['--adopt=false']],
  ['invalid target', ['--target', 'other']],
  ['empty framework', ['--framework=']],
  ['multiple project paths', ['first', 'second']],
]) {
  test(`init rejects ${name} with exit code 2`, () => {
    const root = temp('invalid-init');
    const result = run(root, ['init', ...args]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /^sunhat: /u);
    assert.throws(() => readFileSync(resolve(root, 'sunhat.toml')));
    assert.throws(() => readFileSync(resolve(root, 'first/package.json')));
  });
}
test('scaffold conflict is detected before any write', () => {
  const root = temp('atomic');
  mkdirSync(resolve(root, 'contracts'));
  writeFileSync(resolve(root, 'contracts/Counter.sol'), 'owned');
  const result = run(dirname(root), [
    'init',
    '--framework',
    'hardhat',
    '--target',
    'evm',
    root,
  ]);
  assert.equal(result.status, 2);
  assert.equal(
    readFileSync(resolve(root, 'contracts/Counter.sol'), 'utf8'),
    'owned',
  );
  assert.throws(() => readFileSync(resolve(root, 'package.json')));
});
test('foundry scaffold does not reference unpublished placeholder packages', () => {
  const root = temp('foundry-init');
  const result = run(dirname(root), ['init', root]);
  assert.equal(result.status, 0, result.stderr);
  const pkg = readFileSync(resolve(root, 'package.json'), 'utf8');
  assert.doesNotMatch(pkg, /@sunhat\/foundry-tron-toolchain/u);
  assert.match(
    readFileSync(resolve(root, 'foundry-toolchain.json'), 'utf8'),
    /elsvv\/foundry-tron/u,
  );
  assert.doesNotMatch(
    readFileSync(resolve(root, 'script/Counter.s.sol'), 'utf8'),
    /forge-std/u,
  );
  assert.doesNotMatch(
    readFileSync(resolve(root, 'test/Counter.t.sol'), 'utf8'),
    /forge-std/u,
  );
});
test('adopt writes only the binding', () => {
  const root = temp('adopt');
  const config = 'export default { solidity: "0.8.26" };\n';
  writeFileSync(resolve(root, 'hardhat.config.ts'), config);
  json(resolve(root, 'package.json'), {
    devDependencies: { hardhat: '2.22.0' },
  });
  const result = run(root, ['init', '--framework', 'hardhat', '--adopt']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(resolve(root, 'hardhat.config.ts'), 'utf8'),
    config,
  );
  assert.match(
    readFileSync(resolve(root, 'sunhat.toml'), 'utf8'),
    /target = "tron"/u,
  );
});
test('hardhat receives literal argv and native exit code', () => {
  const root = temp('hh');
  binding(root, 'hardhat', 'evm');
  hardhat(root);
  const result = run(root, ['compile', '$HOME', 'test argument']);
  assert.equal(result.status, 17);
  assert.equal(result.stdout, '["compile","$HOME","test argument"]');
});
test('invalid TOML stops command routing with exit code 4', () => {
  const root = temp('invalid-toml');
  binding(root, 'hardhat', 'evm');
  hardhat(root);
  writeFileSync(
    resolve(root, 'sunhat.toml'),
    '[project]\nframework = "hardhat"\ntarget = "evm"\ntarget = "tron"\n',
  );
  const result = run(root, ['compile']);
  assert.equal(result.status, 4);
  assert.match(result.stderr, /invalid TOML/u);
  assert.equal(result.stdout, '');
});
test('legacy framework namespaces are rejected', () => {
  const result = run(temp('legacy'), ['foundry', 'build']);
  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /namespace is no longer supported.*sunhat build/u,
  );
});
test('Hardhat commands are passed through without a namespace', () => {
  const root = temp('hh-toolchain');
  binding(root, 'hardhat', 'evm');
  hardhat(root);
  const result = run(root, ['toolchain', 'check']);
  assert.equal(result.status, 17);
  assert.equal(result.stdout, '["toolchain","check"]');
});
test('foundry native commands and tools select exact binaries', () => {
  const root = temp('foundry');
  binding(root, 'foundry', 'evm');
  foundry(root, 'evm');
  assert.equal(
    run(root, ['build', '--sizes']).stdout,
    'forge:["build","--sizes"]',
  );
  assert.equal(
    run(root, ['compile', '--force']).stdout,
    'forge:["compile","--force"]',
  );
  assert.equal(
    run(root, ['cast', 'block-number']).stdout,
    'cast:["block-number"]',
  );
  const info = run(root, ['toolchain', 'info']);
  assert.equal(info.status, 0);
  assert.match(info.stdout, /source=foundry-rs\/foundry/u);
  assert.match(info.stdout, /release=v1\.8\.6/u);
});
test('TRON rejects anvil without launching toolchain', () => {
  const root = temp('tron');
  binding(root, 'foundry', 'tron');
  const result = run(root, ['anvil']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unsupported.*TRON/u);
});
test('Hardhat 3 is rejected with resolved version', () => {
  const root = temp('hh3');
  binding(root, 'hardhat', 'evm');
  hardhat(root, '3.0.0');
  const result = run(root, ['test']);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /Hardhat 2.*3\.0\.0/u);
});
test('Foundry accepts a legacy lock without comparing its recorded digest', () => {
  const root = temp('digest');
  binding(root, 'foundry', 'evm');
  foundry(root, 'evm');
  const lockPath = resolve(root, '.sunhat/toolchain.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.version = 1;
  for (const binary of Object.values(lock.binaries)) {
    binary.sha256 = '0'.repeat(64);
  }
  json(lockPath, lock);
  executable(
    resolve(root, '.sunhat/toolchains/evm/forge'),
    `process.stdout.write('updated:'+JSON.stringify(process.argv.slice(2)));`,
  );
  const result = run(root, ['build']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'updated:["build"]');
});
