import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { test } from 'node:test';
import {
  getCacheDir,
  setMockCacheDir,
  resetMockCacheDir,
} from '@nomicfoundation/hardhat-utils/global-dir';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import plugin from '../dist/plugins/tron/index.js';
import core from '../vendor/hardhat-tron/index.js';

const require = createRequire(import.meta.url);
const soljson = readFileSync(require.resolve('solc/soljson.js'));
const sha = (value) => createHash('sha256').update(value).digest('hex');

function temporary(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-compiler-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    resolve(root, 'package.json'),
    JSON.stringify({ name: 'compiler-fixture', private: true, type: 'module' }),
  );
  return root;
}

async function mirrors(t) {
  const requests = [];
  const offline = new Set();
  const payloads = new Map(
    ['a', 'b', 'same'].map((name) => [
      name,
      Buffer.concat([soljson, Buffer.from(`\n// Source ${name}\n`)]),
    ]),
  );
  const build = (name) => {
    const longVersion =
      name === 'b' ? '0.8.26+commit.second' : '0.8.26+commit.first';
    return {
      version: '0.8.26',
      longVersion,
      path: `soljson-v${longVersion}.js`,
      sha256: sha(payloads.get(name)),
    };
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture');
    const name = url.searchParams.get('source') ?? url.pathname.split('/')[1];
    requests.push({ name, path: url.pathname });
    if (offline.has(name) || !payloads.has(name)) {
      response.writeHead(503).end('offline');
    } else if (url.pathname.endsWith('list.json')) {
      response.end(JSON.stringify({ builds: [build(name)] }));
    } else {
      response.end(payloads.get(name));
    }
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  t.after(
    () =>
      new Promise((closed) => {
        server.closeAllConnections();
        server.close(closed);
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, offline, payloads, build };
}

test('compiler caches isolate mirror selection, concurrent requests and identical long versions', async (t) => {
  const root = temporary(t);
  const source = await mirrors(t);
  const compiler = core.createCompiler({ cacheDir: root });
  const listeners = process.listeners('unhandledRejection');
  const options = { mirror: source.url + '/a/' };
  const pending = compiler.getCompiler('0.8.26', options);
  options.mirror = source.url + '/b';
  const [a, duplicate, b, same] = await Promise.all([
    pending,
    compiler.getCompiler('0.8.26', { mirror: source.url + '/a' }),
    compiler.getCompiler('0.8.26', options),
    compiler.getCompiler('0.8.26', { mirror: source.url + '/same' }),
  ]);
  assert.equal(a.compilerPath, duplicate.compilerPath);
  assert.notEqual(a.longVersion, b.longVersion);
  assert.equal(a.longVersion, same.longVersion);
  assert.notEqual(a.compilerPath, same.compilerPath);
  for (const [name, result] of [
    ['a', a],
    ['b', b],
    ['same', same],
  ]) {
    assert.equal(
      sha(readFileSync(result.compilerPath)),
      sha(source.payloads.get(name)),
    );
    assert.equal(
      source.requests.filter((request) => request.name === name).length,
      2,
    );
    assert.ok(result.compilerPath.endsWith('.cjs'));
    const warm = await core
      .createCompiler({ cacheDir: root })
      .getCompiler('0.8.26', { mirror: source.url + '/' + name });
    assert.equal(warm.compilerPath, result.compilerPath);
    assert.equal(
      source.requests.filter((request) => request.name === name).length,
      2,
    );
  }
  assert.deepEqual(process.listeners('unhandledRejection'), listeners);
  const query = await compiler.getCompiler('0.8.26', {
    mirror: source.url + '/proxy/?source=a',
  });
  assert.notEqual(query.compilerPath, a.compilerPath);
  assert.equal(
    sha(readFileSync(query.compilerPath)),
    sha(source.payloads.get('a')),
  );
  assert.ok(
    source.requests.some((request) => request.path === '/proxy/wasm/list.json'),
  );
});

test('offline fallback stays within the selected source and ignores legacy unscoped caches', async (t) => {
  const root = temporary(t);
  const source = await mirrors(t);
  const compiler = core.createCompiler({ cacheDir: root });
  await compiler.getCompiler('0.8.26', { mirror: source.url + '/a' });
  writeFileSync(
    join(root, 'list.json'),
    JSON.stringify({ builds: [source.build('a')] }),
  );
  source.offline.add('a');
  source.offline.add('b');
  const warnings = [];
  t.mock.method(console, 'warn', (message) => warnings.push(message));
  const stale = await compiler.loadManifest({
    mirror: source.url + '/a',
    forceRefresh: true,
  });
  assert.equal(stale.builds[0].longVersion, source.build('a').longVersion);
  assert.equal(warnings.length, 1);
  await assert.rejects(
    compiler.getCompiler('0.8.26', { mirror: source.url + '/b' }),
    /HTTP 503/,
  );
  source.offline.delete('b');
  const retry = await compiler.getCompiler('0.8.26', {
    mirror: source.url + '/b',
  });
  assert.equal(retry.longVersion, source.build('b').longVersion);
});

test('default cache follows the public host helper on the current platform', async () => {
  const mirror = 'https://example.invalid/compiler';
  const root = await getCacheDir();
  const actual = await core.createCompiler().compilerCacheDir(mirror);
  assert.equal(
    actual,
    join(root, 'compilers-v3', 'wasm', 'tron-solc', 'mirrors', sha(mirror)),
  );
});

test('public HRE build and global cleanup own default caches while explicit ESM-project overrides remain independent', async (t) => {
  const root = temporary(t);
  const source = await mirrors(t);
  const global = join(root, 'host-cache');
  setMockCacheDir(global);
  t.after(resetMockCacheDir);
  mkdirSync(join(root, 'contracts'));
  writeFileSync(
    join(root, 'contracts', 'Cache.sol'),
    '// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract Cache { function value() external pure returns (uint256) { return 7; } }\n',
  );
  const create = (cacheDir) =>
    createHardhatRuntimeEnvironment(
      {
        plugins: [plugin],
        solidity: '0.8.26',
        tre: {
          autoStart: false,
          compiler: {
            target: 'tron',
            mirror: source.url + '/a',
            ...(cacheDir === undefined ? {} : { cacheDir }),
          },
        },
      },
      {},
      root,
    );
  const overridden = await create('./local-compiler-cache');
  assert.equal(
    existsSync(global),
    false,
    'An explicit cache must not create the default host directory',
  );
  const customPath =
    overridden.config.solidity.profiles.default.compilers[0].path;
  assert.ok(customPath.startsWith(join(root, 'local-compiler-cache')));
  await overridden.tasks.getTask('build').run();
  assert.ok(
    (await overridden.artifacts.readArtifact('Cache')).bytecode.length > 2,
  );
  const normal = await create();
  const defaultPath = normal.config.solidity.profiles.default.compilers[0].path;
  assert.ok(defaultPath.startsWith(join(global, 'compilers-v3')));
  await normal.tasks.getTask('clean').run({ global: true });
  assert.equal(existsSync(defaultPath), false);
  assert.equal(existsSync(customPath), true);
  const cleanRequests = source.requests.length;
  const rebuilt = await create();
  assert.equal(
    rebuilt.config.solidity.profiles.default.compilers[0].path,
    defaultPath,
  );
  assert.ok(source.requests.length > cleanRequests);
});

test('worker probes preserve non-Error thrown values and remove failed staging files', async (t) => {
  const root = temporary(t);
  const source = await mirrors(t);
  for (const [name, payload, expected] of [
    ['a', 'throw null;', null],
    ['b', 'throw undefined;', undefined],
    ['same', 'process.exit(0);', 'exit'],
  ]) {
    source.payloads.set(name, Buffer.from(payload));
    const compiler = core.createCompiler({ cacheDir: root });
    await assert.rejects(
      compiler.getCompiler('0.8.26', { mirror: source.url + '/' + name }),
      (error) => {
        assert.match(error.message, /failed to load tron-solc/);
        if (expected === 'exit') {
          assert.match(error.cause.message, /without a result/);
        } else {
          assert.equal(error.cause, expected);
        }
        return true;
      },
    );
    const files = readdirSync(
      await compiler.compilerCacheDir(source.url + '/' + name),
    );
    assert.deepEqual(files, ['list.json']);
  }
});
