import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { parse } from 'smol-toml';
import {
  configureFoundryTemplates,
  foundryInitArgs,
  foundryInitEnv,
} from './fixtures/foundry-init.js';
import { copyCliRuntime } from './fixtures/runtime.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const runtime = mkdtempSync(resolve(tmpdir(), 'sunhat-command-runtime-'));
after(() => rmSync(runtime, { recursive: true, force: true }));
const { packageRoot, cli } = copyCliRuntime(resolve(runtime, 'package'));
configureFoundryTemplates(packageRoot);
const downloadFixture = fileURLToPath(
  new URL('./fixtures/toolchain-download.js', import.meta.url),
);
const version = JSON.parse(
  readFileSync(resolve(repository, 'package.json'), 'utf8'),
).version;
const releases = {
  evm: { source: 'foundry-rs/foundry', release: 'v1.8.6', revision: 'v1.8.6' },
  tron: {
    source: 'elsvv/foundry-tron',
    release: 'foundry-tron-latest',
    revision: '9ea07db4b342fd606f6f7c3f99be1757e90d5e90',
  },
};

for (const flag of ['--help', '-h']) {
  test(`init ${flag} returns to its caller without creating a project`, (t) => {
    const temporary = mkdtempSync(resolve(tmpdir(), 'sunhat-init-help-'));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const destination = resolve(temporary, 'unused-project');
    const moduleUrl = new URL('../dist/cli/init.js', import.meta.url).href;
    const program = `
      import { initProject } from ${JSON.stringify(moduleUrl)};
      const status = await initProject(${JSON.stringify([flag, destination])});
      process.stdout.write('returned:' + status + '\\n');
    `;
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', program],
      { cwd: temporary, encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /Usage: sunhat init/u);
    assert.match(result.stdout, /returned:0\n$/u);
    assert.equal(existsSync(destination), false);
  });
}

// Cover the template commands and every routing branch. Native frameworks own
// their full task lists; these executables record dispatch without compiling or
// broadcasting transactions, starting servers, or requiring Docker/network access.
const hardhatCommands = [
  ['compile'],
  ['compile', '--force'],
  ['test'],
  ['test', '--grep', 'Counter'],
  ['node'],
  ['run', 'scripts/deploy.ts'],
  ['clean'],
  ['console', '--no-compile'],
  ['flatten', 'contracts/Counter.sol'],
  ['help', 'compile'],
  ['toolchain', 'install'],
  ['toolchain', 'check'],
  ['toolchain', 'info'],
  [
    'custom-plugin-task',
    '--flag',
    'space value',
    '$HOME',
    '$(literal)',
    'a;b',
    '',
    '--',
    '--literal',
  ],
];
const forgeCommands = [
  ['build'],
  ['build', '--sizes'],
  ['compile', '--force'],
  ['test'],
  ['test', '-vvv'],
  ['test', '--match-contract', 'CounterTest'],
  ['test', '--gas-report'],
  ['snapshot'],
  ['coverage'],
  ['script', 'script/Counter.s.sol:CounterScript'],
  ['create', 'src/Counter.sol:Counter'],
  ['clean'],
  ['fmt', '--check'],
  ['inspect', 'src/Counter.sol:Counter', 'abi'],
  ['help', 'build'],
  [
    'custom-forge-command',
    '--flag',
    'space value',
    '$HOME',
    '$(literal)',
    'a;b',
    '',
    '--',
    '--literal',
  ],
];

function run(cwd, args, { env = {}, preload = false } = {}) {
  const nodeArgs = [
    ...(args[0] === 'init' || (args[0] === 'toolchain' && args[1] === 'install')
      ? foundryInitArgs
      : []),
    ...(preload ? ['--import', downloadFixture] : []),
  ];
  return spawnSync(process.execPath, [...nodeArgs, cli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, ...foundryInitEnv, ...env },
  });
}

function json(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function project(t, framework, target) {
  const temporary = mkdtempSync(
    resolve(tmpdir(), `sunhat-init-${framework}-${target}-`),
  );
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const destination = resolve(temporary, 'project with spaces');
  const initialized = run(temporary, [
    'init',
    '--framework',
    framework,
    '--target',
    target,
    destination,
  ]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const root = realpathSync(destination);
  const binding = parse(readFileSync(resolve(root, 'sunhat.toml'), 'utf8'));
  assert.equal(binding.project.framework, framework);
  assert.equal(binding.project.target, target);
  const nested = resolve(root, 'nested directory', 'contracts');
  mkdirSync(nested, { recursive: true });
  const log = resolve(temporary, 'invocations.jsonl');
  return {
    root,
    nested,
    framework,
    target,
    log,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
        : [],
  };
}

function recorder(path, project, tool) {
  mkdirSync(dirname(path), { recursive: true });
  const identity = {
    framework: project.framework,
    target: project.target,
    tool,
  };
  writeFileSync(
    path,
    `#!/usr/bin/env node
const call = { ...${JSON.stringify(identity)}, args: process.argv.slice(2), cwd: process.cwd() };
require('node:fs').appendFileSync(${JSON.stringify(project.log)}, JSON.stringify(call) + '\\n');
process.stdout.write(JSON.stringify(call));
process.stderr.write(process.env.SUNHAT_TEST_STDERR ?? '');
process.exitCode = Number(process.env.SUNHAT_TEST_EXIT_CODE ?? 0);
`,
  );
  chmodSync(path, 0o755);
}

function installFrameworkFixture(project) {
  if (project.framework === 'hardhat') {
    const pkg = JSON.parse(
      readFileSync(resolve(project.root, 'package.json'), 'utf8'),
    );
    const base = resolve(project.root, 'node_modules/hardhat');
    json(resolve(base, 'package.json'), {
      name: 'hardhat',
      version: pkg.devDependencies.hardhat,
      bin: { hardhat: 'cli.cjs' },
    });
    recorder(resolve(base, 'cli.cjs'), project, 'hardhat');
  } else {
    const binaries = {};
    for (const tool of ['forge', 'cast', 'anvil', 'chisel']) {
      const filename = project.target === 'tron' ? `${tool}-tron` : tool;
      const path = `.sunhat/toolchains/${project.target}/${filename}`;
      recorder(resolve(project.root, path), project, tool);
      binaries[tool] = {
        path,
      };
    }
    json(resolve(project.root, '.sunhat/toolchain.json'), {
      version: 2,
      target: project.target,
      ...releases[project.target],
      platform: 'test',
      binaries,
    });
  }
  // Expose the real CLI to the generated npm scripts without installing packages.
  const bin = resolve(project.root, 'node_modules/.bin');
  mkdirSync(bin, { recursive: true });
  symlinkSync(cli, resolve(bin, 'sunhat'));
}

function expectedCall(project, tool, args) {
  return {
    framework: project.framework,
    target: project.target,
    tool,
    args,
    cwd: project.root,
  };
}

function assertNative(project, cwd, args, tool, forwarded, env = {}) {
  const before = project.calls().length;
  const result = run(cwd, args, { env });
  assert.equal(
    result.status,
    Number(env.SUNHAT_TEST_EXIT_CODE ?? 0),
    result.stderr || String(result.error ?? ''),
  );
  assert.equal(result.stderr, env.SUNHAT_TEST_STDERR ?? '');
  const expected = expectedCall(project, tool, forwarded);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.deepEqual(project.calls().slice(before), [expected]);
}

for (const framework of ['foundry', 'hardhat']) {
  for (const target of ['evm', 'tron']) {
    test(`init ${framework}/${target}: command matrix`, async (t) => {
      const initialized = project(t, framework, target);
      installFrameworkFixture(initialized);
      const commands =
        framework === 'hardhat'
          ? hardhatCommands.map((args) => ({
              args,
              tool: 'hardhat',
              forwarded: args,
            }))
          : [
              ...forgeCommands.map((args) => ({
                args,
                tool: 'forge',
                forwarded: args,
              })),
              {
                args: ['cast', 'block-number'],
                tool: 'cast',
                forwarded: ['block-number'],
              },
              {
                args: [
                  'cast',
                  'call',
                  'contract with spaces',
                  'value()(uint256)',
                ],
                tool: 'cast',
                forwarded: ['call', 'contract with spaces', 'value()(uint256)'],
              },
              ...(target === 'evm'
                ? [
                    {
                      args: ['anvil', '--port', '9545'],
                      tool: 'anvil',
                      forwarded: ['--port', '9545'],
                    },
                    {
                      args: ['chisel', '--no-banner'],
                      tool: 'chisel',
                      forwarded: ['--no-banner'],
                    },
                  ]
                : []),
            ];
      for (const { args, tool, forwarded } of commands) {
        await t.test(args.join(' '), () => {
          for (const cwd of [initialized.root, initialized.nested]) {
            assertNative(initialized, cwd, args, tool, forwarded);
          }
        });
      }

      await t.test('generated npm build and test scripts', () => {
        for (const script of ['build', 'test']) {
          const before = initialized.calls().length;
          const npmArgs = ['run', script, '--', 'literal argument'];
          const result = process.env.npm_execpath
            ? spawnSync(
                process.execPath,
                [process.env.npm_execpath, ...npmArgs],
                { cwd: initialized.nested, encoding: 'utf8', timeout: 10_000 },
              )
            : spawnSync('npm', npmArgs, {
                cwd: initialized.nested,
                encoding: 'utf8',
                timeout: 10_000,
              });
          assert.equal(
            result.status,
            0,
            result.stderr || String(result.error ?? ''),
          );
          const command =
            script === 'test'
              ? 'test'
              : framework === 'hardhat'
                ? 'compile'
                : 'build';
          assert.deepEqual(initialized.calls().slice(before), [
            expectedCall(
              initialized,
              framework === 'hardhat' ? 'hardhat' : 'forge',
              [command, 'literal argument'],
            ),
          ]);
        }
      });

      await t.test('preserves native failure exit status and stderr', () => {
        const command = framework === 'hardhat' ? 'compile' : 'build';
        assertNative(
          initialized,
          initialized.nested,
          [command],
          framework === 'hardhat' ? 'hardhat' : 'forge',
          [command],
          {
            SUNHAT_TEST_EXIT_CODE: '23',
            SUNHAT_TEST_STDERR: 'native compiler failure\n',
          },
        );
      });

      await t.test(
        'global help/version and legacy namespaces do not launch a framework',
        () => {
          const before = initialized.calls().length;
          for (const flag of ['--help', '-h']) {
            const result = run(initialized.nested, [flag]);
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /sunhat <command>/u);
          }
          for (const flag of ['--version', '-V']) {
            const result = run(initialized.nested, [flag]);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(result.stdout, `sunhat ${version}\n`);
          }
          for (const namespace of ['hardhat', 'foundry']) {
            const result = run(initialized.nested, [namespace, 'test']);
            assert.equal(result.status, 2, result.stderr);
            assert.match(result.stderr, /namespace is no longer supported/u);
          }
          assert.equal(initialized.calls().length, before);
        },
      );

      if (framework === 'foundry') {
        await t.test(
          'toolchain info uses the initialized target without launching Forge',
          () => {
            const before = initialized.calls().length;
            const info = run(initialized.nested, ['toolchain', 'info']);
            assert.equal(info.status, 0, info.stderr);
            assert.equal(
              info.stdout,
              `framework=foundry\ntarget=${target}\nsource=${releases[target].source}\nrelease=${releases[target].release}\nrevision=${releases[target].revision}\nplatform=test\n`,
            );
            for (const args of [
              [],
              ['unknown'],
              ['check'],
              ['check', '--extra'],
              ['install', 'extra'],
            ]) {
              const result = run(initialized.nested, ['toolchain', ...args]);
              assert.equal(result.status, 2, result.stderr);
              assert.match(
                result.stderr,
                /toolchain requires exactly one command/u,
              );
            }
            assert.equal(initialized.calls().length, before);
          },
        );

        if (target === 'tron') {
          await t.test(
            'anvil/chisel are rejected before launching the installed binaries',
            () => {
              const before = initialized.calls().length;
              for (const tool of ['anvil', 'chisel']) {
                const result = run(initialized.nested, [tool]);
                assert.equal(result.status, 2, result.stderr);
                assert.match(
                  result.stderr,
                  new RegExp(`${tool} is unsupported for the TRON target`, 'u'),
                );
              }
              assert.equal(initialized.calls().length, before);
            },
          );
        }

        await t.test(
          'native execution uses the current installed executable',
          () => {
            const before = initialized.calls().length;
            const lock = JSON.parse(
              readFileSync(
                resolve(initialized.root, '.sunhat/toolchain.json'),
                'utf8',
              ),
            );
            const executable = resolve(
              initialized.root,
              lock.binaries.forge.path,
            );
            writeFileSync(
              executable,
              `${readFileSync(executable, 'utf8')}\n// changed after installation\n`,
            );
            const result = run(initialized.nested, ['build']);
            assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(
              JSON.parse(result.stdout),
              expectedCall(initialized, 'forge', ['build']),
            );
            assert.equal(initialized.calls().length, before + 1);
          },
        );
      }
    });
  }
}

for (const target of ['evm', 'tron']) {
  test(`init foundry/${target}: failed initialization reports a recoverable install error`, (t) => {
    const temporary = mkdtempSync(resolve(tmpdir(), 'sunhat-init-failure-'));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const root = resolve(temporary, 'project');
    const initialized = run(temporary, ['init', '--target', target, root], {
      preload: true,
      env: {
        SUNHAT_TEST_DOWNLOAD: 'digest-mismatch',
        SUNHAT_TEST_DOWNLOAD_LOG: resolve(temporary, 'download.txt'),
      },
    });
    assert.equal(initialized.status, 3, initialized.stderr);
    assert.match(initialized.stderr, /archive digest mismatch/u);
    assert.match(initialized.stderr, /retry with `sunhat toolchain install`/u);
    assert.ok(existsSync(resolve(root, 'sunhat.toml')));
    assert.equal(existsSync(resolve(root, '.sunhat/toolchain.json')), false);
    const retried = run(root, ['toolchain', 'install']);
    assert.equal(retried.status, 0, retried.stderr);
    const build = run(root, ['build']);
    assert.equal(build.status, 0, build.stderr);
    assert.equal(build.stdout, '["build"]');
  });
  test(`init foundry/${target}: toolchain install download failures`, async (t) => {
    const initialized = project(t, 'foundry', target);
    rmSync(resolve(initialized.root, '.sunhat'), {
      recursive: true,
      force: true,
    });
    await t.test('info/build report a missing toolchain', () => {
      for (const args of [['toolchain', 'info'], ['build']]) {
        const result = run(initialized.nested, args);
        assert.equal(result.status, 3, result.stderr);
        assert.match(result.stderr, /toolchain is not installed/u);
      }
    });
    for (const mode of ['http-error', 'digest-mismatch']) {
      await t.test(mode, () => {
        const log = resolve(initialized.root, 'download-url.txt');
        const result = run(initialized.nested, ['toolchain', 'install'], {
          preload: true,
          env: { SUNHAT_TEST_DOWNLOAD: mode, SUNHAT_TEST_DOWNLOAD_LOG: log },
        });
        assert.equal(result.status, 3, result.stderr);
        assert.match(
          result.stderr,
          mode === 'http-error'
            ? /download failed \(503\)/u
            : /archive digest mismatch/u,
        );
        const platform = `${process.platform}_${process.arch === 'x64' ? 'amd64' : process.arch}`;
        const extension = process.platform === 'win32' ? 'zip' : 'tar.gz';
        const archive =
          target === 'evm'
            ? `foundry_v1.8.6_${platform}.${extension}`
            : `foundry-tron_${platform}.${extension}`;
        assert.equal(
          readFileSync(log, 'utf8'),
          `https://github.com/${releases[target].source}/releases/download/${releases[target].release}/${archive}`,
        );
        assert.equal(
          existsSync(resolve(initialized.root, '.sunhat/toolchain.json')),
          false,
        );
        assert.equal(
          existsSync(resolve(initialized.root, '.sunhat/toolchains')),
          false,
        );
      });
    }
  });
}
