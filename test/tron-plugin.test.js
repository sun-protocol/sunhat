import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import plugin from '../dist/plugins/tron/index.js';
import ethersMatchers from '@nomicfoundation/hardhat-ethers-chai-matchers';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { createServer } from 'node:http';
import core from '../vendor/hardhat-tron/index.js';
import { normalizeTre } from '../dist/plugins/tron/settings.js';
import { withCleanup } from '../dist/plugins/tron/cleanup.js';
import { readTronDefaults } from '../dist/plugins/tron/defaults.js';
import {
  createTreManager,
  taskContext,
} from '../dist/plugins/tron/resources.js';

test('Hardhat forwards native HTTP credentials and redacts readiness failures', async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.headers['x-api-key'] !== 'test-token') {
      response.writeHead(401).end('{}');
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    if (request.url.includes('getnodeinfo')) {
      response.end('{"configNodeInfo":{"codeVersion":"test"}}');
    } else if (request.url.includes('getnowblock')) {
      response.end('{"block_header":{"raw_data":{"number":1}}}');
    } else if (request.url.includes('getaccount')) {
      response.end('{"balance":5}');
    } else {
      response.writeHead(404).end('{}');
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((done) => server.close(done));
  });
  const url = `http://127.0.0.1:${server.address().port}/private-path/jsonrpc?token=private-query`;
  const hre = await createHardhatRuntimeEnvironment(
    {
      plugins: [plugin],
      tre: { compiler: { target: 'evm' }, fundSigners: false },
      networks: {
        tre: {
          type: 'http',
          tron: true,
          url,
          httpHeaders: { 'X-API-Key': 'test-token' },
          accounts: ['0x' + '1'.padStart(64, '0')],
        },
      },
    },
    {},
    process.cwd(),
  );
  const connection = await hre.network.create('tre');
  await withCleanup(
    async () => {
      assert.equal(
        await connection.ethers.provider.getBalance('0x' + '2'.repeat(40)),
        5n,
      );
      const [signer] = await connection.ethers.getSigners();
      assert.equal(await signer.tronWeb.trx.getBalance(signer.tronAddress), 5);
      assert.ok(
        requests.every(
          (entry) =>
            entry.startsWith('/private-path/') &&
            entry.endsWith('?token=private-query'),
        ),
      );
    },
    () => connection.close(),
  );
  const manager = createTreManager({
    ...core.createLifecycle(),
    isReachable: async () => false,
  });
  await assert.rejects(
    () => manager.acquire(normalizeTre(undefined), url),
    (error) => {
      assert.match(error.message, /TRON node is not ready/);
      assert.ok(
        !error.message.includes('private-path') &&
          !error.message.includes('private-query'),
      );
      return true;
    },
  );
});

test('TRON defaults read configuration data and reject invalid or missing assets', (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-defaults-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = resolve(root, 'defaults.json');
  const configured = {
    image: 'example/tre:test',
    compilerMirror: 'https://example.invalid/solc',
  };
  writeFileSync(path, JSON.stringify(configured));
  assert.deepEqual(readTronDefaults(path), configured);
  for (const value of [
    null,
    [],
    {},
    { ...configured, image: ' ' },
    { ...configured, compilerMirror: 42 },
  ]) {
    writeFileSync(path, JSON.stringify(value));
    assert.throws(
      () => readTronDefaults(path),
      (error) => {
        assert.match(error.message, /Invalid TRON defaults/);
        assert.ok(error.message.includes(path));
        return true;
      },
    );
  }
  writeFileSync(path, '{');
  assert.throws(
    () => readTronDefaults(path),
    (error) => {
      assert.ok(error.cause instanceof SyntaxError);
      assert.ok(error.message.includes(path));
      return true;
    },
  );
  rmSync(path);
  assert.throws(
    () => readTronDefaults(path),
    (error) => {
      assert.equal(error.cause.code, 'ENOENT');
      assert.ok(error.message.includes(path));
      return true;
    },
  );
});

test('optional TRON configuration rejects null objects', () => {
  for (const value of [
    null,
    { compiler: null },
    { startupEnv: null },
    { compiler: { batches: null } },
  ]) {
    assert.throws(() => normalizeTre(value), /must (be|contain)/);
  }
});

test('programmatic EVM configuration retains its compiler and resolves separate TRON artifacts and jar paths', async (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-hre-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(resolve(root, 'package.json'), '{"type":"module"}');
  const hre = await createHardhatRuntimeEnvironment(
    {
      plugins: [plugin],
      paths: { artifacts: 'artifacts-tron' },
      solidity: '0.8.26',
      tre: { jarPath: './tre/patched.jar', compiler: { enabled: false } },
    },
    {},
    root,
  );
  assert.equal(hre.config.tre.compiler.target, 'evm');
  assert.equal(hre.config.paths.artifacts, resolve(root, 'artifacts-tron'));
  assert.notEqual(
    hre.config.tre.artifactPaths.evm,
    hre.config.tre.artifactPaths.tron,
  );
  assert.equal(hre.config.tre.jarPath, resolve(root, 'tre/patched.jar'));
  for (const profile of Object.values(hre.config.solidity.profiles)) {
    for (const compiler of profile.compilers) {
      assert.equal(compiler.path, undefined);
    }
  }
});

test('invalid signing scalars fail before Docker or network work', async (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-keys-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(resolve(root, 'package.json'), '{"type":"module"}');
  for (const key of ['0x' + '0'.repeat(64), '0x' + 'f'.repeat(64)]) {
    const hre = await createHardhatRuntimeEnvironment(
      {
        plugins: [plugin],
        solidity: '0.8.26',
        tre: { autoStart: true, compiler: { target: 'evm' } },
        networks: {
          default: {
            type: 'http',
            tron: true,
            url: 'http://127.0.0.1:1/jsonrpc',
            accounts: [
              {
                _type: 'ConfigurationVariable',
                name: 'SUNHAT_INVALID_TEST_KEY',
                default: key,
              },
            ],
          },
        },
      },
      {},
      root,
    );
    await assert.rejects(hre.network.create(), (error) => {
      assert.match(error.message, /Invalid TRON signing account/);
      assert.ok(!error.message.includes(key));
      return true;
    });
  }
});

function fakeLifecycle() {
  let running = false;
  let starts = 0;
  let stops = 0;
  return {
    async ensureUp(_, url) {
      if (running) {
        return { spawned: false, name: null, url };
      }
      running = true;
      starts += 1;
      return { spawned: true, name: String(starts), id: String(starts), url };
    },
    teardown() {
      running = false;
      stops += 1;
    },
    async isReachable() {
      return running;
    },
    isLoopbackHost: (host) =>
      ['127.0.0.1', 'localhost', '[::1]'].includes(host),
    containerServing: () =>
      running ? { name: String(starts), id: String(starts) } : undefined,
    associateOwnedUrl() {},
    hostMatchesBinding: (host, binding) =>
      host === 'localhost' || host === binding,
    status() {
      return { running, starts, stops };
    },
  };
}
test('owned TRE release and concurrent reacquire cannot reuse a disappearing container', async () => {
  const lifecycle = fakeLifecycle();
  const manager = createTreManager(lifecycle);
  const config = normalizeTre({ autoStart: true });
  await taskContext.run('test', async () => {
    const first = await manager.acquire(
      config,
      'http://127.0.0.1:9090/jsonrpc',
    );
    const [, next] = await Promise.all([
      first(),
      manager.acquire(config, 'http://127.0.0.1:9090/jsonrpc'),
    ]);
    assert.equal(lifecycle.status().running, true);
    assert.equal(lifecycle.status().starts, 2);
    await next();
    assert.deepEqual(lifecycle.status(), {
      running: false,
      starts: 2,
      stops: 2,
    });
  });
});
test('node acquisition promotes an existing owned TRE lease to persistent', async () => {
  const lifecycle = fakeLifecycle();
  const manager = createTreManager(lifecycle);
  const config = normalizeTre({ autoStart: true });
  const first = await taskContext.run('test', () =>
    manager.acquire(config, 'http://127.0.0.1:9090/jsonrpc'),
  );
  const node = await taskContext.run('node', () =>
    manager.acquire(config, 'http://127.0.0.1:9090/jsonrpc'),
  );
  await first();
  await node();
  assert.deepEqual(lifecycle.status(), { running: true, starts: 1, stops: 0 });
});

function managedNodes(t) {
  const containers = new Map();
  const removed = [];
  let starts = 0;
  let failRemoval = false;
  let discoverable = true;
  t.mock.method(globalThis, 'fetch', async (source, options) => {
    const url = new URL(source);
    if (new Headers(options.headers).get('authorization') === 'invalid') {
      return new Response('{}', { status: 401 });
    }
    const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
    const ready = [...containers.values()].some(
      (entry) => entry.host === host && entry.port === (url.port || '80'),
    );
    if (!ready) {
      throw new TypeError('fetch failed');
    }
    return Response.json(
      url.pathname.endsWith('getnodeinfo')
        ? { configNodeInfo: { codeVersion: 'test' } }
        : { block_header: { raw_data: { number: 1 } } },
    );
  });
  const lifecycle = core.createLifecycle({
    process: {
      spawnSync(_command, args) {
        if (args[0] === 'run') {
          starts += 1;
          const name = args[args.indexOf('--name') + 1];
          const [host, port] = args[args.indexOf('-p') + 1].split(':');
          const id = starts.toString(16).padStart(64, '0');
          containers.set(name, { host, port, id });
          return { status: 0, stdout: id };
        }
        if (args[0] === 'rm') {
          if (failRemoval) {
            return { status: 1, stderr: 'EXPECTED_REMOVE_FAILURE' };
          }
          const owned = [...containers].find(
            ([, entry]) => entry.id === args[2],
          );
          removed.push(args[2]);
          if (owned) {
            containers.delete(owned[0]);
          }
          return { status: 0 };
        }
        if (!discoverable) {
          return { status: 1, stderr: 'EXPECTED_DOCKER_UNAVAILABLE' };
        }
        if (args[0] === 'ps') {
          return {
            status: 0,
            stdout: [...containers.values()]
              .map((entry) => entry.id)
              .join('\n'),
          };
        }
        return {
          status: 0,
          stdout: [...containers]
            .map(([name, entry]) => {
              const ports = {
                '9090/tcp': [{ HostIp: entry.host, HostPort: entry.port }],
              };
              return `${entry.id}|2026-01-01|/${name}|${JSON.stringify(ports)}`;
            })
            .join('\n'),
        };
      },
    },
  });
  return {
    lifecycle,
    containers,
    removed,
    starts: () => starts,
    failRemoval: (value) => {
      failRemoval = value;
    },
    discoverable: (value) => {
      discoverable = value;
    },
  };
}

test('actual container ownership shares alias leases in either release order', async (t) => {
  const nodes = managedNodes(t);
  const manager = createTreManager(nodes.lifecycle);
  const config = normalizeTre({ autoStart: true });
  for (const firstIndex of [0, 1]) {
    const releases = await taskContext.run('test', () =>
      Promise.all([
        manager.acquire(config, 'http://127.0.0.1:9090/jsonrpc'),
        manager.acquire(config, 'http://localhost:9090/jsonrpc'),
      ]),
    );
    assert.equal(nodes.starts(), firstIndex + 1);
    await releases[firstIndex]();
    assert.equal(nodes.containers.size, 1);
    await releases[1 - firstIndex]();
    await releases[firstIndex]();
    assert.equal(nodes.containers.size, 0);
    assert.equal(nodes.removed.length, firstIndex + 1);
  }
});

test('failed alias acquisitions cannot promote or invalidate an existing lease', async (t) => {
  const nodes = managedNodes(t);
  const manager = createTreManager(nodes.lifecycle);
  const config = normalizeTre({ autoStart: true });
  const release = await taskContext.run('test', () =>
    manager.acquire(config, 'http://127.0.0.1:9090/jsonrpc'),
  );
  await assert.rejects(
    taskContext.run('node', () =>
      manager.acquire(config, 'http://localhost:9090/jsonrpc', {
        Authorization: 'invalid',
      }),
    ),
    /HTTP 401/,
  );
  await assert.rejects(
    manager.acquire(
      { ...config, image: 'conflicting:image' },
      'http://localhost:9090/jsonrpc',
    ),
    /Conflicting TRE/,
  );
  nodes.discoverable(false);
  await assert.rejects(
    manager.acquire(config, 'http://localhost:9090/jsonrpc'),
    /Cannot identify/,
  );
  nodes.discoverable(true);
  const alias = await manager.acquire(config, 'http://localhost:9090/jsonrpc');
  await release();
  assert.equal(nodes.containers.size, 1);
  await alias();
  assert.equal(nodes.containers.size, 0);
});

test('distinct interfaces and external nodes never acquire owned cleanup', async (t) => {
  const nodes = managedNodes(t);
  const manager = createTreManager(nodes.lifecycle);
  const config = normalizeTre({ autoStart: true });
  const owned = await taskContext.run('test', () =>
    manager.acquire(config, 'http://127.0.0.1:9090/jsonrpc'),
  );
  nodes.containers.set('external-ipv4', { host: '127.0.0.2', port: '9090' });
  nodes.containers.set('external-ipv6', { host: '[::1]', port: '9090' });
  nodes.discoverable(false);
  const other = await manager.acquire(config, 'http://127.0.0.2:9090/jsonrpc');
  const ipv6 = await taskContext.run('test', () =>
    manager.acquire(config, 'http://[::1]:9090/jsonrpc'),
  );
  await owned();
  await other();
  await ipv6();
  assert.deepEqual(
    [...nodes.containers.keys()],
    ['external-ipv4', 'external-ipv6'],
  );
  assert.equal(nodes.removed.length, 1);
});

test('failed final teardown retains ownership for a later cleanup attempt', async (t) => {
  const nodes = managedNodes(t);
  const manager = createTreManager(nodes.lifecycle);
  const config = normalizeTre({ autoStart: true });
  const release = await taskContext.run('test', () =>
    manager.acquire(config, 'http://127.0.0.1:9090/jsonrpc'),
  );
  nodes.failRemoval(true);
  await assert.rejects(release(), /EXPECTED_REMOVE_FAILURE/);
  const retry = await manager.acquire(config, 'http://localhost:9090/jsonrpc');
  nodes.failRemoval(false);
  await retry();
  assert.equal(nodes.containers.size, 0);
});

test('an old lease cannot remove an external container that reused its name', async (t) => {
  const nodes = managedNodes(t);
  const manager = createTreManager(nodes.lifecycle);
  const config = normalizeTre({ autoStart: true });
  const release = await taskContext.run('test', () =>
    manager.acquire(config, 'http://127.0.0.1:9090/jsonrpc'),
  );
  const [name, original] = [...nodes.containers][0];
  const replacement = { ...original, id: 'f'.repeat(64) };
  nodes.containers.set(name, replacement);
  const alias = await manager.acquire(config, 'http://localhost:9090/jsonrpc');
  await release();
  await alias();
  assert.equal(nodes.containers.get(name), replacement);
  assert.deepEqual(nodes.removed, [original.id]);
});
test('connection cleanup preserves every original thrown value', async () => {
  for (const original of [
    new Error('EXPECTED_PRIMARY'),
    undefined,
    null,
    false,
  ]) {
    let caught = false;
    try {
      await withCleanup(
        async () => {
          throw original;
        },
        async () => {
          throw new Error('EXPECTED_CLEANUP');
        },
      );
    } catch (error) {
      caught = true;
      assert.equal(error, original);
    }
    assert.equal(caught, true);
  }
});

test(
  'TRON matcher registration preserves the official EVM balance matcher',
  { timeout: 10000 },
  async () => {
    const hre = await createHardhatRuntimeEnvironment(
      {
        plugins: [plugin, ethersMatchers],
        tre: { compiler: { target: 'evm' } },
      },
      {},
      process.cwd(),
    );
    const connection = await hre.network.create();
    await withCleanup(
      async () => {
        core.registerMatchers();
        const [sender, recipient] = await connection.ethers.getSigners();
        const response = await sender.sendTransaction({
          to: recipient.address,
          value: 9n,
        });
        const addressable = { getAddress: async () => recipient.address };
        await expect(response).to.changeEtherBalance(
          connection.ethers,
          addressable,
          9n,
        );
        await expect(response).to.changeEtherBalances(
          connection.ethers,
          [sender, new Contract(addressable, [])],
          [-9n, 9n],
        );
      },
      () => connection.close(),
    );
  },
);
