import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(
  readFileSync(resolve(repository, 'package.json'), 'utf8'),
);

function invoke(args, cwd, timeout = 30_000) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function run(args, cwd, timeout = 30_000) {
  const result = invoke(args, cwd, timeout);
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
  async (t) => {
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
    assert.equal(generated.devDependencies.sunhat, undefined);
    assert.equal(generated.devDependencies.hardhat, '3.21.1');
    // Install the generated framework dependencies without a project-local CLI.
    run(
      [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
      project,
      90_000,
    );
    assert.equal(
      JSON.parse(readFileSync(resolve(project, 'package.json'))).devDependencies
        .sunhat,
      undefined,
    );
    await t.test(
      'package engines agree with the installed runtime guards',
      async () => {
        const installed = resolve(consumer, 'node_modules', metadata.name);
        const { isSupportedNode } = await import(
          pathToFileURL(resolve(installed, 'dist/runtime.js')).href
        );
        const { isHardhat3NodeSupported } = await import(
          pathToFileURL(resolve(installed, 'dist/project/hardhat.js')).href
        );
        // semver is an explicit dependency of the installed Hardhat package.
        const hardhatRequire = createRequire(
          resolve(project, 'node_modules/hardhat/package.json'),
        );
        const { satisfies } = hardhatRequire('semver');
        const core = JSON.parse(
          readFileSync(resolve(installed, 'package.json'), 'utf8'),
        );
        const lock = JSON.parse(
          readFileSync(resolve(repository, 'package-lock.json'), 'utf8'),
        );
        assert.equal(lock.packages[''].engines.node, core.engines.node);
        const templates = [
          ['foundry/evm', isSupportedNode],
          ['foundry/tron', isSupportedNode],
          ['hardhat/v2/evm', isSupportedNode],
          [
            'hardhat/v2/tron',
            (version) => isSupportedNode(version, { major: 22, minor: 0 }),
          ],
          ['hardhat/v3/evm', isHardhat3NodeSupported],
          ['hardhat/v3/tron', isHardhat3NodeSupported],
        ];
        const versions = [
          '18.0.0',
          '20.10.0',
          '20.11.0',
          '21.0.0',
          '22.0.0',
          '22.12.0',
          '22.13.0',
          '23.0.0',
          '24.0.0',
          '25.0.0',
          '26.0.0',
          '27.0.0',
          '28.0.0',
          '30.0.0',
        ];
        for (const version of versions) {
          assert.equal(
            satisfies(version, core.engines.node),
            isSupportedNode(version),
            `CLI engines for Node ${version}`,
          );
          for (const [template, supported] of templates) {
            const manifest = JSON.parse(
              readFileSync(
                resolve(installed, 'templates', template, 'package.json'),
                'utf8',
              ),
            );
            assert.equal(
              satisfies(version, manifest.engines.node),
              supported(version),
              `${template} engines for Node ${version}`,
            );
          }
        }
      },
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
    await t.test(
      'network cleanup preserves original exceptions and reports secondary failures',
      () => {
        const fixtures = resolve(repository, 'test/fixtures/hardhat3-cleanup');
        cpSync(
          resolve(fixtures, 'failing-close.config.js'),
          resolve(project, 'failing-close.config.js'),
        );
        mkdirSync(resolve(project, 'checks'));
        cpSync(
          resolve(fixtures, 'check.ts'),
          resolve(project, 'checks/cleanup.ts'),
        );
        const checked = run(
          [
            cli,
            'run',
            'checks/cleanup.ts',
            '--config',
            'failing-close.config.js',
            '--no-compile',
          ],
          project,
        );
        assert.match(
          checked.stdout,
          /Original errors preserved; cleanup-only failure propagated/u,
        );
        assert.match(
          checked.stderr,
          /Failed to close Hardhat network connection/u,
        );
        assert.match(checked.stderr, /EXPECTED_CLOSE_FAILURE/u);
      },
    );
    await t.test(
      'the generated deployment and test retain artifact errors when closing also fails',
      () => {
        rmSync(resolve(project, 'artifacts'), { recursive: true, force: true });
        for (const args of [
          ['run', 'scripts/deploy.ts'],
          ['test', 'mocha'],
        ]) {
          const failed = invoke(
            [
              cli,
              ...args,
              '--config',
              'failing-close.config.js',
              '--no-compile',
            ],
            project,
          );
          const output = [failed.error?.message, failed.stdout, failed.stderr]
            .filter(Boolean)
            .join('\n');
          assert.equal(failed.status, 1, output);
          assert.match(output, /Artifact for contract "Counter" not found/u);
          assert.match(
            failed.stderr,
            /Failed to close Hardhat network connection/u,
          );
          assert.match(failed.stderr, /EXPECTED_CLOSE_FAILURE/u);
        }
      },
    );
  },
);
