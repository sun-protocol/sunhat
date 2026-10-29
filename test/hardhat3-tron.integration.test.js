import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));
const image =
  'tronbox/tre@sha256:f4332e11df12a9f360639a4546fd046593909630fda48af00b30410c144342f0';
const compilerUrl =
  'https://raw.githubusercontent.com/tronprotocol/solc-bin/32695fe4b8d85704da9ec4cedce107a905e412ac/wasm/soljson-v0.8.26+commit.733b4d28.js';
const compilerSha256 =
  '31fe546b9e6ad74e816d6406dcdb59f3af180f9c1145fd994bd5205d9c8465c1';
// Public first development key for hardhat-tron's deterministic TRE mnemonic.
const privateKey =
  'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    encoding: 'utf8',
    timeout: 45_000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
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

async function waitForNode(host) {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/wallet/getnodeinfo', host), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(2_000),
      });
      assert.equal(response.ok, true);
      const info = await response.json();
      assert.match(info.configNodeInfo.codeVersion, /^4\.8\.2/u);
      const block = await fetch(new URL('/wallet/getnowblock', host), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(2_000),
      });
      assert.equal(block.ok, true);
      const current = await block.json();
      assert.ok(current.block_header.raw_data.number >= 1);
      return info.configNodeInfo.codeVersion;
    } catch (error) {
      lastError = error;
    }
    await setTimeout(500);
  }
  throw new Error(`TRE did not become ready at ${host}`, { cause: lastError });
}

test(
  'Hardhat 3 compiles with tron-solc and executes a native TVM probe on Docker TRE',
  { timeout: 360_000 },
  async (t) => {
    const npm = process.env.npm_execpath;
    assert.ok(
      npm,
      'Run this compatibility probe with npm run test:hardhat3:tron',
    );
    const temporary = mkdtempSync(resolve(tmpdir(), 'sunhat-hardhat3-tron-'));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const project = resolve(temporary, 'native TRON probe');
    cpSync(resolve(repository, 'test/fixtures/hardhat3-tron'), project, {
      recursive: true,
    });
    mkdirSync(resolve(project, 'contracts'));
    cpSync(
      resolve(repository, 'templates/hardhat/3/common/contracts/Counter.sol'),
      resolve(project, 'contracts/Counter.sol'),
    );
    const compilerPath = resolve(temporary, 'tron-soljson.cjs');
    let compiler;
    if (process.env.SUNHAT_TRON_SOLC) {
      compiler = readFileSync(process.env.SUNHAT_TRON_SOLC);
    } else {
      const response = await fetch(compilerUrl, {
        signal: AbortSignal.timeout(90_000),
      });
      assert.equal(response.ok, true, `Compiler HTTP ${response.status}`);
      compiler = Buffer.from(await response.arrayBuffer());
    }
    assert.equal(
      createHash('sha256').update(compiler).digest('hex'),
      compilerSha256,
    );
    writeFileSync(compilerPath, compiler);
    run(
      process.execPath,
      [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: project, timeout: 120_000 },
    );

    const container = `sunhat-hardhat3-${randomUUID()}`;
    // Register cleanup before docker run, including launch timeout/error paths.
    t.after(() => {
      const removed = spawnSync('docker', ['rm', '-f', container], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      if (
        removed.status !== 0 &&
        !removed.stderr?.includes('No such container')
      ) {
        assert.fail(
          `Could not remove test container ${container}: ${removed.error?.message ?? removed.stderr}`,
        );
      }
    });
    run(
      'docker',
      [
        'run',
        '-d',
        '--name',
        container,
        '--label',
        'sunhat.test=hardhat3-tron',
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
        '--restart',
        'no',
        image,
      ],
      { timeout: 90_000 },
    );
    try {
      const ports = JSON.parse(
        run('docker', [
          'inspect',
          '--format',
          '{{json .NetworkSettings.Ports}}',
          container,
        ]).stdout,
      );
      const binding = ports['9090/tcp'];
      assert.equal(binding.length, 1);
      assert.equal(binding[0].HostIp, '127.0.0.1');
      assert.match(binding[0].HostPort, /^\d+$/u);
      const host = `http://127.0.0.1:${binding[0].HostPort}`;
      const nodeVersion = await waitForNode(host);
      const options = {
        cwd: project,
        env: {
          ...process.env,
          SUNHAT_TRON_SOLC: compilerPath,
          TRE_URL: host,
          TRE_PRIVATE_KEY: privateKey,
        },
      };
      const hardhat = resolve(project, 'node_modules/hardhat/dist/src/cli.js');
      const built = run(process.execPath, [hardhat, 'build'], options);
      assert.match(built.stdout, /Compiled 1 Solidity file/u);
      const tested = run(process.execPath, [hardhat, 'test', 'mocha'], {
        ...options,
        timeout: 120_000,
      });
      assert.match(tested.stdout, /1 passing/u);
      const summary = tested.stdout.match(/TRE_RESULT (\{[^\n]+\})/u);
      assert.ok(summary, tested.stdout);
      const details = JSON.parse(summary[1]);
      t.diagnostic(
        JSON.stringify({
          image,
          nodeVersion,
          hardhat: '3.21.1',
          compiler: {
            url: compilerUrl,
            sha256: compilerSha256,
            longVersion: details.compilerLongVersion,
          },
          ...details,
        }),
      );
    } catch (error) {
      const logs = spawnSync('docker', ['logs', '--tail', '30', container], {
        encoding: 'utf8',
        timeout: 10_000,
      });
      t.diagnostic(
        `TRE container ${container}\n${logs.stdout}\n${logs.stderr}`,
      );
      throw error;
    }
  },
);
