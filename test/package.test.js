import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'smol-toml';
import {
  configureFoundryTemplates,
  foundryInitArgs,
  foundryInitEnv,
} from './fixtures/foundry-init.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(
  readFileSync(resolve(repository, 'package.json'), 'utf8'),
);

function run(args, cwd, { env = {}, timeout = 30_000 } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    [args.join(' '), result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n'),
  );
  return result;
}

test(
  'the packed CLI works outside the repository and initializes all project variants',
  { timeout: 180_000 },
  async (t) => {
    const npm = process.env.npm_execpath;
    assert.ok(npm, 'Run this integration suite with npm run pack:check');
    assert.equal(
      existsSync(resolve(repository, 'dist')),
      false,
      'pack:check must start without build artifacts',
    );
    const temporary = realpathSync(
      mkdtempSync(resolve(tmpdir(), 'sunhat-package-')),
    );
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const archives = resolve(temporary, 'archives');
    mkdirSync(archives);
    run([npm, 'pack', '--pack-destination', archives], repository, {
      timeout: 90_000,
    });
    const tarballs = readdirSync(archives).filter((name) =>
      name.endsWith('.tgz'),
    );
    assert.equal(tarballs.length, 1);

    const consumer = resolve(temporary, 'consumer with spaces');
    mkdirSync(consumer);
    writeFileSync(
      resolve(consumer, 'package.json'),
      JSON.stringify({ name: 'sunhat-package-consumer', private: true }),
    );
    run(
      [
        npm,
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        resolve(archives, tarballs[0]),
      ],
      consumer,
      { timeout: 90_000 },
    );
    const installed = resolve(consumer, 'node_modules', metadata.name);
    assert.equal(lstatSync(installed).isSymbolicLink(), false);
    const cli = resolve(installed, 'bin/sunhat.js');

    await t.test(
      'the artifact contains runtime files, templates and documentation',
      () => {
        for (const path of [
          'dist/cli/main.js',
          'dist/package.js',
          'templates',
          'README.md',
          'docs/QuickStart.md',
          'docs/toml-binding.md',
        ]) {
          assert.ok(existsSync(resolve(installed, path)), `missing ${path}`);
        }
        for (const path of ['src', 'test', '.github']) {
          assert.equal(
            existsSync(resolve(installed, path)),
            false,
            `unexpected ${path}`,
          );
        }
      },
    );

    await t.test(
      'npm installs a working CLI executable with the package version',
      () => {
        assert.ok(
          existsSync(
            resolve(
              consumer,
              'node_modules/.bin',
              process.platform === 'win32' ? 'sunhat.cmd' : 'sunhat',
            ),
          ),
        );
        const version = run(
          [npm, 'exec', '--offline', '--no', '--', 'sunhat', '--version'],
          consumer,
        );
        assert.equal(version.stdout, `sunhat ${metadata.version}\n`);
      },
    );

    await t.test(
      'the installed CLI shows help without a project binding',
      () => {
        const help = run([cli, '--help'], consumer);
        assert.match(help.stdout, /sunhat <command>/u);
      },
    );

    configureFoundryTemplates(installed);
    for (const framework of ['foundry', 'hardhat']) {
      for (const target of ['evm', 'tron']) {
        await t.test(
          `${framework}/${target} initializes from the installed templates`,
          () => {
            const project = resolve(consumer, `${framework}-${target}`);
            run(
              [
                ...(framework === 'foundry' ? foundryInitArgs : []),
                cli,
                'init',
                '--framework',
                framework,
                '--target',
                target,
                project,
              ],
              consumer,
              {
                env: foundryInitEnv,
              },
            );
            const manifest = JSON.parse(
              readFileSync(resolve(project, 'package.json'), 'utf8'),
            );
            assert.equal(
              manifest.devDependencies.sunhat,
              `npm:${metadata.name}@${metadata.version}`,
            );
            const binding = parse(
              readFileSync(resolve(project, 'sunhat.toml'), 'utf8'),
            );
            assert.equal(binding.project.framework, framework);
            assert.equal(binding.project.target, target);
            const readme = readFileSync(resolve(project, 'README.md'), 'utf8');
            assert.ok(readme.includes(`${metadata.name}@${metadata.version}`));
            assert.doesNotMatch(readme, /\{\{sunhatPackage\}\}/u);
            const paths =
              framework === 'foundry'
                ? [
                    'foundry.toml',
                    'src/Counter.sol',
                    'test/Counter.t.sol',
                    'script/Counter.s.sol',
                  ]
                : [
                    'hardhat.config.ts',
                    'tsconfig.json',
                    'contracts/Counter.sol',
                    'test/Counter.test.ts',
                    'scripts/deploy.ts',
                  ];
            for (const path of paths) {
              assert.ok(existsSync(resolve(project, path)), `missing ${path}`);
            }
            if (framework === 'foundry') {
              const lock = JSON.parse(
                readFileSync(
                  resolve(project, '.sunhat/toolchain.json'),
                  'utf8',
                ),
              );
              assert.equal(lock.target, target);
              assert.deepEqual(Object.keys(lock.binaries).sort(), [
                'anvil',
                'cast',
                'chisel',
                'forge',
              ]);
              for (const binary of Object.values(lock.binaries)) {
                assert.ok(existsSync(resolve(project, binary.path)));
              }
            }
          },
        );
      }
    }
  },
);
