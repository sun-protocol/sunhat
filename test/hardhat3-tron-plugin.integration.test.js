import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  readdirSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  image,
  compilerUrl,
  compilerSha256,
  privateKey,
  run,
  waitForNode,
} from './helpers/tre.js';

const repository = fileURLToPath(new URL('../', import.meta.url));

async function freePort() {
  const server = createServer();
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise((closed) => server.close(closed));
  return port;
}

function removeContainer(name) {
  const removed = spawnSync('docker', ['rm', '-f', name], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.ok(
    removed.status === 0 || removed.stderr?.includes('No such container'),
    `Failed to clean test container ${name}: ${removed.error?.message ?? removed.stderr}`,
  );
}
test(
  'the packaged Hardhat 3 TRON plugin works on ordinary and patched Docker TRE',
  { timeout: 360000 },
  async (t) => {
    const npm = process.env.npm_execpath;
    assert.ok(npm);
    const jar =
      process.env.SUNHAT_PATCHED_TRE_JAR ??
      resolve(repository, '.sunhat/tre/FullNode.jar');
    const jarDigest = createHash('sha256')
      .update(readFileSync(jar))
      .digest('hex');
    const temporary = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-plugin-'));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const archiveDir = resolve(temporary, 'archives');
    mkdirSync(archiveDir);
    const packed = JSON.parse(
      run(process.execPath, [
        npm,
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        archiveDir,
      ]).stdout,
    );
    const archive = resolve(archiveDir, packed[0].filename);
    const project = resolve(temporary, 'plugin project');
    cpSync(resolve(repository, 'test/fixtures/hardhat3-tron-plugin'), project, {
      recursive: true,
    });
    mkdirSync(resolve(project, 'contracts'), { recursive: true });
    cpSync(
      resolve(repository, 'templates/hardhat/common/contracts/Counter.sol'),
      resolve(project, 'contracts/Counter.sol'),
    );
    const dependencies = JSON.parse(
      readFileSync(
        resolve(repository, 'test/fixtures/hardhat3-tron/package.json'),
      ),
    ).devDependencies;
    writeFileSync(
      resolve(project, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        devDependencies: {
          ...dependencies,
          '@nomicfoundation/hardhat-ethers': '4.2.1',
          solc: '0.8.26',
          '@nomicfoundation/hardhat-ethers-chai-matchers': '3.0.11',
          chai: '5.3.3',
          '@types/chai': '5.2.2',
          typescript: '5.8.3',
          '@types/node': '22.10.2',
          '@types/mocha': '10.0.10',
          sunhat: 'file:' + archive,
        },
      }),
    );
    run(
      process.execPath,
      [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: project, timeout: 120000 },
    );
    const compilerPath = resolve(temporary, 'tron-soljson.cjs');
    const compiler = process.env.SUNHAT_TRON_SOLC
      ? readFileSync(process.env.SUNHAT_TRON_SOLC)
      : Buffer.from(
          await (
            await fetch(compilerUrl, { signal: AbortSignal.timeout(90000) })
          ).arrayBuffer(),
        );
    assert.equal(
      createHash('sha256').update(compiler).digest('hex'),
      compilerSha256,
    );
    writeFileSync(compilerPath, compiler);
    for (const patched of [false, true]) {
      await t.test(
        patched
          ? 'patched TRE helper compatibility'
          : 'ordinary TRE native transactions and explicit capability failures',
        async (subtest) => {
          const name = `sunhat-tron-plugin-${randomUUID()}`;
          subtest.after(() => {
            const removed = spawnSync('docker', ['rm', '-f', name], {
              encoding: 'utf8',
              timeout: 30000,
            });
            assert.ok(
              removed.status === 0 ||
                removed.stderr?.includes('No such container'),
              removed.stderr,
            );
          });
          const args = [
            'run',
            '-d',
            '--name',
            name,
            '--label',
            'sunhat.test=hardhat3-tron-plugin',
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
            '-e',
            'quiet=true',
            '-e',
            'JAVA_TOOL_OPTIONS=-XX:+UseG1GC -XX:MaxGCPauseMillis=20 -Xmx2g -Xms512m -XX:+AlwaysPreTouch -XX:+TieredCompilation',
          ];
          if (patched) {
            args.push('-v', `${jar}:/tron/FullNode/FullNode.jar:ro`);
          }
          args.push(image);
          run('docker', args, { timeout: 90000 });
          const bindings = JSON.parse(
            run('docker', [
              'inspect',
              '--format',
              '{{json .NetworkSettings.Ports}}',
              name,
            ]).stdout,
          );
          const binding = bindings['9090/tcp'][0];
          assert.equal(binding.HostIp, '127.0.0.1');
          const url = `http://127.0.0.1:${binding.HostPort}`;
          await waitForNode(url);
          let otherUrl;
          if (patched) {
            const otherName = `sunhat-tron-isolation-${randomUUID()}`;
            subtest.after(() => removeContainer(otherName));
            const otherArgs = args.slice(0, args.indexOf('-v'));
            otherArgs[otherArgs.indexOf('--name') + 1] = otherName;
            run('docker', [...otherArgs, image], { timeout: 90000 });
            const otherBindings = JSON.parse(
              run('docker', [
                'inspect',
                '--format',
                '{{json .NetworkSettings.Ports}}',
                otherName,
              ]).stdout,
            );
            otherUrl = `http://127.0.0.1:${otherBindings['9090/tcp'][0].HostPort}`;
            await waitForNode(otherUrl);
          }
          const options = {
            cwd: project,
            env: {
              ...process.env,
              SUNHAT_TRON_SOLC: compilerPath,
              TRE_URL: url,
              TRE_PRIVATE_KEY: '0x' + privateKey,
              SUNHAT_PATCHED_TRE: String(patched),
              ...(otherUrl ? { TRE_OTHER_URL: otherUrl } : {}),
            },
            timeout: 150000,
          };
          const hardhat = resolve(
            project,
            'node_modules/hardhat/dist/src/cli.js',
          );
          run(
            process.execPath,
            [hardhat, 'build', '--config', 'hardhat.evm.config.js'],
            options,
          );
          run(process.execPath, [hardhat, 'build'], options);
          const versions = (directory) =>
            readdirSync(resolve(project, directory, 'build-info'))
              .filter((name) => name.endsWith('.json'))
              .map(
                (name) =>
                  JSON.parse(
                    readFileSync(
                      resolve(project, directory, 'build-info', name),
                    ),
                  ).solcLongVersion,
              )
              .filter(Boolean);
          assert.ok(
            versions('artifacts').some((version) =>
              version.startsWith('0.8.26+commit.8a97fa7a'),
            ),
          );
          assert.ok(
            versions('artifacts-tron').some((version) =>
              version.startsWith('0.8.26+commit.733b4d28'),
            ),
          );
          run(
            process.execPath,
            [
              hardhat,
              'tron:compile-batches',
              '--config',
              'hardhat.batches.config.js',
            ],
            options,
          );
          assert.ok(
            existsSync(
              resolve(
                project,
                'artifacts-batches-tron/contracts/Counter.sol/Counter.json',
              ),
            ),
          );
          assert.ok(
            existsSync(
              resolve(
                project,
                'artifacts-batches-tron/contracts/TokenFixture.sol/TokenFixture.json',
              ),
            ),
          );
          assert.ok(
            !existsSync(
              resolve(
                project,
                'artifacts-batches-tron/contracts/Excluded.sol/Excluded.json',
              ),
            ),
          );
          assert.ok(
            existsSync(
              resolve(
                project,
                'artifacts-batches-tron/contracts/AddressFactoryFixture.sol/AddressFactoryFixture.json',
              ),
            ),
          );
          run(
            process.execPath,
            [resolve(project, 'node_modules/typescript/bin/tsc'), '--noEmit'],
            options,
          );
          const tested = run(
            process.execPath,
            [hardhat, 'test', 'mocha', '--no-compile'],
            options,
          );
          assert.match(tested.stdout, /6 passing/);
          assert.match(tested.stdout, /TRON_PLUGIN_RESULT/);
          subtest.diagnostic(
            `image=${image}; patchedJarSha256=${patched ? jarDigest : 'none'}; ${tested.stdout.match(/TRON_PLUGIN_RESULT .*/)?.[0]}`,
          );
        },
      );
    }
    await t.test(
      'owned Mocha startup, failure cleanup and persistent node task',
      async (subtest) => {
        const hardhat = resolve(
          project,
          'node_modules/hardhat/dist/src/cli.js',
        );
        for (const mode of [
          'success',
          'failure',
          'keep',
          'compile',
          'disabled',
        ]) {
          const name = `sunhat-tron-owned-${randomUUID()}`;
          subtest.after(() => removeContainer(name));
          const options = {
            cwd: project,
            timeout: 150000,
            env: {
              ...process.env,
              SUNHAT_TRON_SOLC: compilerPath,
              TRE_PRIVATE_KEY: '0x' + privateKey,
              TRE_URL: `http://127.0.0.1:${await freePort()}`,
              SUNHAT_TRE_AUTO: 'true',
              SUNHAT_TRE_NAME: name,
              SUNHAT_TRE_KEEP: String(mode === 'keep'),
              SUNHAT_OWNED_JAR: jar,
              SUNHAT_PATCHED_TRE: 'true',
              SUNHAT_TRE_AUTO_COMPILE: String(mode === 'compile'),
              SUNHAT_TRE_AUTO_TEST: String(mode !== 'disabled'),
            },
          };
          if (mode === 'failure') {
            const failed = spawnSync(
              process.execPath,
              [hardhat, 'test', 'mocha', 'failure.fixture.js', '--no-compile'],
              { ...options, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
            );
            assert.equal(failed.status, 1, failed.stdout + failed.stderr);
            assert.match(
              failed.stdout + failed.stderr,
              /EXPECTED_TRON_TEST_FAILURE/,
            );
          } else if (mode === 'compile') {
            run(process.execPath, [hardhat, 'build'], options);
          } else if (mode === 'disabled') {
            const tested = run(
              process.execPath,
              [hardhat, 'test', 'mocha', '--no-compile', '--grep', '^$'],
              options,
            );
            assert.match(tested.stdout, /0 passing/);
          } else {
            const tested = run(
              process.execPath,
              [hardhat, 'test', 'mocha', '--no-compile'],
              options,
            );
            assert.match(tested.stdout, /6 passing/);
          }
          if (mode === 'success') {
            const aliases = run(
              process.execPath,
              [hardhat, 'run', 'scripts/lifecycle.js', '--no-compile'],
              options,
            );
            assert.match(aliases.stdout, /TRE_LEASE_STILL_READY/);
          }
          const state = spawnSync(
            'docker',
            ['inspect', '--format', '{{.State.Running}}', name],
            { encoding: 'utf8', timeout: 30000 },
          );
          assert.equal(
            state.status === 0,
            mode === 'keep',
            `Owned container policy ${mode}: ${state.stdout}`,
          );
          if (mode === 'keep') {
            const reused = run(
              process.execPath,
              [hardhat, 'run', 'scripts/lifecycle.js', '--no-compile'],
              options,
            );
            assert.match(reused.stdout, /TRE_LEASE_STILL_READY/);
            assert.equal(
              run('docker', [
                'inspect',
                '--format',
                '{{.State.Running}}',
                name,
              ]).stdout.trim(),
              'true',
            );
            run('docker', ['rm', '-f', name]);
          }
        }
        const name = `sunhat-tron-node-${randomUUID()}`;
        subtest.after(() => removeContainer(name));
        const child = spawn(
          process.execPath,
          [hardhat, 'node', '--network', 'tre'],
          {
            cwd: project,
            env: {
              ...process.env,
              SUNHAT_TRON_SOLC: compilerPath,
              TRE_PRIVATE_KEY: '0x' + privateKey,
              TRE_URL: `http://127.0.0.1:${await freePort()}`,
              SUNHAT_TRE_AUTO: 'true',
              SUNHAT_TRE_NAME: name,
              SUNHAT_OWNED_JAR: jar,
              SUNHAT_PATCHED_TRE: 'true',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let output = '';
        child.stdout.on('data', (chunk) => {
          output += chunk;
        });
        child.stderr.on('data', (chunk) => {
          output += chunk;
        });
        subtest.after(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        });
        const deadline = Date.now() + 90000;
        while (
          !output.includes('TRON node ready') &&
          Date.now() < deadline &&
          child.exitCode === null
        ) {
          await setTimeout(100);
        }
        assert.match(output, /TRON node ready/);
        await setTimeout(1000);
        assert.equal(child.exitCode, null, output);
        const exited = new Promise((done) =>
          child.once('exit', (code, signal) => done({ code, signal })),
        );
        child.kill('SIGTERM');
        const deadlineController = new AbortController();
        let result;
        try {
          result = await Promise.race([
            exited,
            setTimeout(15000, undefined, {
              signal: deadlineController.signal,
            }).then(() => {
              throw new Error('Persistent node did not exit after SIGTERM');
            }),
          ]);
        } finally {
          deadlineController.abort();
        }
        assert.equal(result.code, 0, output);
        assert.equal(
          run('docker', [
            'inspect',
            '--format',
            '{{.State.Running}}',
            name,
          ]).stdout.trim(),
          'true',
        );
      },
    );
  },
);
