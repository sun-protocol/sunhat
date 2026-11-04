import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after } from 'node:test';
import {
  configureFoundryTemplates,
  foundryInstallArgs,
  foundryInstallEnv,
} from './fixtures/foundry-install.js';
import { copyCliRuntime } from './fixtures/runtime.js';
import { isHardhat3NodeSupported } from '../dist/project/hardhat.js';

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
    [
      ...(args[0] === 'toolchain' && args[1] === 'install'
        ? foundryInstallArgs
        : []),
      cli,
      ...args,
    ],
    {
      cwd,
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, ...foundryInstallEnv },
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
  assert.equal(existsSync(resolve(root, '.sunhat')), false);
  assert.match(result.stderr, /sunhat toolchain install/u);
  const installed = run(root, ['toolchain', 'install']);
  assert.equal(installed.status, 0, installed.stderr);
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
  assert.equal(existsSync(resolve(root, '.sunhat')), false);
  assert.match(result.stderr, /sunhat toolchain install/u);
  const installed = run(root, ['toolchain', 'install']);
  assert.equal(installed.status, 0, installed.stderr);
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
  assert.equal(pkg.devDependencies.sunhat, undefined);
  assert.equal(pkg.scripts.build, 'hardhat compile');
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
  ['uppercase framework', ['--framework', 'Hardhat']],
  ['framework with whitespace', ['--framework', ' hardhat']],
  ['uppercase target', ['--target', 'EVM']],
  ['target with whitespace', ['--target', 'tron ']],
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
test('Hardhat 3 forwards native commands on supported Node versions', () => {
  const root = temp('hh3');
  binding(root, 'hardhat', 'evm');
  json(resolve(root, 'package.json'), {
    type: 'module',
    devDependencies: { hardhat: '3.21.1' },
  });
  hardhat(root, '3.21.1');
  const result = run(root, [
    'test',
    'mocha',
    '--grep',
    'space value',
    '--',
    '',
  ]);
  if (!isHardhat3NodeSupported(process.versions.node)) {
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, /Hardhat 3.*Node.js.*22\.13/su);
    assert.equal(result.stdout, '');
  } else {
    assert.equal(result.status, 17, result.stderr);
    assert.equal(
      result.stdout,
      '["test","mocha","--grep","space value","--",""]',
    );
  }
});

test('Hardhat 3 EVM initialization is offline and uses separate ESM templates', () => {
  const parent = temp('hh3-scaffold');
  const root = resolve(parent, 'project');
  const result = run(parent, [
    'init',
    '--framework',
    'hardhat',
    '--hardhat-version',
    '3',
    '--target',
    'evm',
    root,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  );
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.devDependencies.hardhat, '3.21.1');
  assert.equal(
    manifest.devDependencies['@nomicfoundation/hardhat-ethers'],
    '4.2.1',
  );
  assert.equal(
    manifest.devDependencies['@openzeppelin/hardhat-tron'],
    undefined,
  );
  assert.equal(manifest.scripts.build, 'hardhat build');
  assert.equal(manifest.scripts.test, 'hardhat test');
  assert.equal(manifest.devDependencies.sunhat, undefined);
  assert.match(
    readFileSync(resolve(root, 'hardhat.config.ts'), 'utf8'),
    /plugins: \[hardhatEthers, hardhatMocha\]/u,
  );
  assert.match(
    readFileSync(resolve(root, 'test/Counter.test.ts'), 'utf8'),
    /withConnection/u,
  );
  assert.match(
    readFileSync(resolve(root, 'helpers/connection.ts'), 'utf8'),
    /network\.create\(\)/u,
  );
  assert.equal(existsSync(resolve(root, 'node_modules')), false);
  assert.equal(existsSync(resolve(root, '.sunhat')), false);
});

for (const args of [
  ['--hardhat-version', '3'],
  ['--framework', 'hardhat', '--hardhat-version', '4'],
  ['--framework', 'hardhat', '--hardhat-version'],
]) {
  test(`invalid Hardhat version selection ${args.join(' ')} writes no project files`, () => {
    const parent = temp('hh-version-args');
    const root = resolve(parent, 'project');
    const result = run(parent, ['init', ...args, root]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /hardhat-version/u);
    assert.equal(existsSync(root), false);
  });
}

test('Hardhat 3 TRON initialization is offline and selects the public plugin', () => {
  const parent = temp('hh3-tron');
  const root = resolve(parent, 'project');
  const result = run(parent, [
    'init',
    '--framework',
    'hardhat',
    '--hardhat-version',
    '3',
    root,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json')));
  assert.equal(manifest.devDependencies.hardhat, '3.21.1');
  assert.equal(
    manifest.devDependencies['@openzeppelin/hardhat-tron'],
    undefined,
  );
  assert.equal(manifest.devDependencies['@openzeppelin/tron-runtime'], '0.1.0');
  assert.match(
    readFileSync(resolve(root, 'hardhat.config.ts'), 'utf8'),
    /sunhat\/hardhat3-tron/u,
  );
  assert.equal(existsSync(resolve(root, 'node_modules')), false);
  assert.equal(existsSync(resolve(root, '.sunhat')), false);
});

for (const [name, declared, moduleType, version, expected] of [
  ['existing ESM project', '3.21.1', 'module', undefined, 0],
  ['explicit major', '3.21.1', 'module', '3', 0],
  ['major mismatch', '2.29.1', 'module', '3', 2],
  ['CommonJS project', '3.21.1', 'commonjs', '3', 2],
  ['unpinned version', '^3.21.1', 'module', '3', 2],
]) {
  test(`Hardhat 3 adoption validates ${name} before writing`, () => {
    const root = temp('hh3-adopt');
    const config = 'export default {};\n';
    writeFileSync(resolve(root, 'hardhat.config.ts'), config);
    const project = {
      type: moduleType,
      devDependencies: { hardhat: declared },
    };
    json(resolve(root, 'package.json'), project);
    const result = run(root, [
      'init',
      '--adopt',
      '--framework',
      'hardhat',
      '--target',
      'evm',
      ...(version ? ['--hardhat-version', version] : []),
      root,
    ]);
    assert.equal(result.status, expected, result.stderr);
    assert.equal(existsSync(resolve(root, 'sunhat.toml')), expected === 0);
    assert.equal(
      readFileSync(resolve(root, 'hardhat.config.ts'), 'utf8'),
      config,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')),
      project,
    );
  });
}

test('Hardhat 3 TRON diagnoses a missing local plugin before framework launch', () => {
  const root = temp('hh3-tron-execute');
  binding(root, 'hardhat', 'tron');
  json(resolve(root, 'package.json'), {
    type: 'module',
    devDependencies: { hardhat: '3.21.1' },
  });
  hardhat(root, '3.21.1');
  const result = run(root, ['test']);
  assert.equal(result.status, 3, result.stderr);
  assert.match(
    result.stderr,
    isHardhat3NodeSupported(process.versions.node)
      ? /Hardhat 3\/TRON.*hardhat3-tron/u
      : /Hardhat 3.*Node.js/u,
  );
  assert.equal(result.stdout, '');
});

for (const [version, expected] of [
  ['2.29.1', 0],
  ['3.21.1', 2],
]) {
  test(`Hardhat ${version} adoption handles a cjs-only configuration before writing`, () => {
    const root = temp('hh-cjs-adopt');
    writeFileSync(
      resolve(root, 'hardhat.config.cjs'),
      'module.exports = {};\n',
    );
    json(resolve(root, 'package.json'), {
      type: 'module',
      devDependencies: { hardhat: version },
    });
    const result = run(root, [
      'init',
      '--adopt',
      '--framework',
      'hardhat',
      '--target',
      'evm',
      root,
    ]);
    assert.equal(result.status, expected, result.stderr);
    assert.equal(existsSync(resolve(root, 'sunhat.toml')), expected === 0);
    if (expected !== 0) {
      assert.match(
        result.stderr,
        /Hardhat 3 requires hardhat.config.ts or hardhat.config.js/u,
      );
    }
  });
}
test('unsupported Hardhat majors are rejected with the resolved version', () => {
  const root = temp('hh4');
  binding(root, 'hardhat', 'evm');
  hardhat(root, '4.0.0');
  const result = run(root, ['test']);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /Hardhat 2 or 3.*4\.0\.0/u);
  assert.equal(result.stdout, '');
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
