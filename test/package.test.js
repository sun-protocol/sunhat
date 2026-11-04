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
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { parse } from 'smol-toml';
import {
  configureFoundryTemplates,
  foundryInstallArgs,
  foundryInstallEnv,
} from './fixtures/foundry-install.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const offlineDownload = new URL(
  './fixtures/toolchain-download.js',
  import.meta.url,
).href;
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
    const internal = resolve(repository, 'docs/internal');
    mkdirSync(internal, { recursive: true });
    const privateFixture = mkdtempSync(resolve(internal, 'package-check-'));
    t.after(() => rmSync(privateFixture, { recursive: true, force: true }));
    writeFileSync(
      resolve(privateFixture, 'private-note.md'),
      'Internal packaging test fixture. This file must not be published.\n',
      { flag: 'wx' },
    );
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
    for (const name of Object.keys(metadata.peerDependencies)) {
      assert.equal(
        existsSync(resolve(consumer, 'node_modules', name)),
        false,
        `CLI-only installation unexpectedly installed optional peer ${name}`,
      );
    }

    await t.test(
      'the artifact installs alongside an existing Hardhat 2 and ethers 5 host',
      () => {
        const legacy = resolve(temporary, 'legacy host');
        mkdirSync(legacy);
        run(
          [
            npm,
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            resolve(archives, tarballs[0]),
            'hardhat@2.22.0',
            'ethers@5.7.2',
          ],
          legacy,
          { timeout: 90000 },
        );
        for (const [name, version] of [
          ['hardhat', '2.22.0'],
          ['ethers', '5.7.2'],
        ]) {
          assert.equal(
            JSON.parse(
              readFileSync(
                resolve(legacy, 'node_modules', name, 'package.json'),
              ),
            ).version,
            version,
          );
        }
        assert.equal(
          run(
            [
              resolve(legacy, 'node_modules', metadata.name, 'bin/sunhat.js'),
              '--version',
            ],
            legacy,
          ).stdout,
          `sunhat ${metadata.version}\n`,
        );
      },
    );

    await t.test(
      'the artifact contains runtime files, templates and documentation',
      () => {
        for (const path of [
          'dist/cli/main.js',
          'dist/package.js',
          'dist/plugins/tron/index.js',
          'dist/plugins/tron/index.d.ts',
          'vendor/hardhat-tron/LICENSE',
          'config/tron-defaults.json',
          'config/compatibility.json',
          'docs/hardhat3-tron-plugin.md',
          'templates',
          'README.md',
          'docs/QuickStart.md',
          'docs/release-2.1.0.md',
        ]) {
          assert.ok(existsSync(resolve(installed, path)), `missing ${path}`);
        }
        for (const path of [
          'src',
          'test',
          '.github',
          'docs/internal',
          'docs/hardhat3-tron-requirements.md',
          'docs/hardhat3-tron-development-plan.md',
          'docs/hardhat3-compatibility.md',
          'docs/toml-binding.md',
        ]) {
          assert.equal(
            existsSync(resolve(installed, path)),
            false,
            `unexpected ${path}`,
          );
        }
      },
    );

    await t.test(
      'installed TRON defaults load outside the repository and preserve project overrides',
      () => {
        const configured = run(
          [
            '--input-type=module',
            '-e',
            `const { normalizeTre } = await import(process.argv[1]);
           console.log(JSON.stringify({
             defaults: normalizeTre(undefined),
             overridden: normalizeTre({ image: 'custom/tre:test', compiler: { mirror: 'https://example.invalid/solc' } })
           }));`,
            pathToFileURL(resolve(installed, 'dist/plugins/tron/settings.js'))
              .href,
          ],
          consumer,
        );
        const { defaults, overridden } = JSON.parse(configured.stdout);
        const asset = JSON.parse(
          readFileSync(resolve(installed, 'config/tron-defaults.json')),
        );
        assert.equal(defaults.image, asset.image);
        assert.equal(defaults.compiler.mirror, asset.compilerMirror);
        assert.equal(overridden.image, 'custom/tre:test');
        assert.equal(
          overridden.compiler.mirror,
          'https://example.invalid/solc',
        );
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
    for (const [framework, version] of [
      ['foundry', undefined],
      ['hardhat', 2],
      ['hardhat', 3],
    ]) {
      for (const target of ['evm', 'tron']) {
        const project = resolve(
          consumer,
          `${framework}-${version ?? 'native'}-${target}`,
        );
        await t.test(
          `${framework}${version ?? ''}/${target} initializes offline from the installed templates`,
          () => {
            const downloadLog = resolve(
              temporary,
              `${framework}-${target}-init-download.txt`,
            );
            const initialized = run(
              [
                '--import',
                offlineDownload,
                cli,
                'init',
                '--framework',
                framework,
                ...(version === undefined
                  ? []
                  : ['--hardhat-version', String(version)]),
                '--target',
                target,
                project,
              ],
              consumer,
              {
                env: {
                  SUNHAT_TEST_DOWNLOAD: 'http-error',
                  SUNHAT_TEST_DOWNLOAD_LOG: downloadLog,
                },
              },
            );
            assert.equal(existsSync(downloadLog), false);
            assert.equal(existsSync(resolve(project, '.sunhat')), false);
            if (framework === 'foundry') {
              assert.match(initialized.stderr, /sunhat toolchain install/u);
            }
            const manifest = JSON.parse(
              readFileSync(resolve(project, 'package.json'), 'utf8'),
            );
            assert.equal(
              manifest.devDependencies?.sunhat,
              framework === 'hardhat' && version === 3 && target === 'tron'
                ? `npm:${metadata.name}@${metadata.version}`
                : undefined,
            );
            assert.equal(manifest.dependencies?.sunhat, undefined);
            assert.equal(manifest.dependencies?.[metadata.name], undefined);
            assert.equal(manifest.devDependencies?.[metadata.name], undefined);
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
          },
        );
        if (framework === 'foundry') {
          await t.test(
            `${framework}/${target} installs npm metadata without a Sunhat dependency`,
            () => {
              run(
                [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
                project,
              );
              const manifest = JSON.parse(
                readFileSync(resolve(project, 'package.json')),
              );
              assert.equal(manifest.dependencies?.sunhat, undefined);
              assert.equal(manifest.devDependencies?.sunhat, undefined);
              assert.equal(
                existsSync(resolve(project, 'node_modules/sunhat')),
                false,
              );
            },
          );
          await t.test(
            `${framework}/${target} installs its toolchain explicitly`,
            () => {
              run(
                [...foundryInstallArgs, cli, 'toolchain', 'install'],
                project,
                {
                  env: foundryInstallEnv,
                },
              );
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
            },
          );
        }
      }
    }
  },
);
