import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import core from '../vendor/hardhat-tron/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
function runtime(url, lifecycle, httpHeaders) {
  return core.createRuntime({
    lifecycle,
    config: { paths: { root, artifacts: root }, tre: { fundSigners: false } },
    network: {
      name: 'tre',
      config: {
        tron: true,
        url,
        httpHeaders,
        accounts: ['1'.padStart(64, '0')],
      },
      provider: { request: async () => ({ hash: 'genesis-fallback' }) },
    },
  });
}

async function node(t, handler) {
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    response.setHeader('Content-Type', 'application/json');
    handler(request.url, JSON.parse(body || '{}'), response, request.headers);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((done) => server.close(done));
  });
  return `http://127.0.0.1:${server.address().port}/jsonrpc`;
}

test('capability failures recover on the same connection and probes coalesce', async (t) => {
  let failing = true;
  let probes = 0;
  let timestamp = 1000;
  const url = await node(t, (path, request, response) => {
    if (path === '/wallet/getnowblock') {
      response.end(
        JSON.stringify({
          block_header: {
            raw_data: { timestamp: timestamp * 1000, number: 1 },
          },
        }),
      );
      return;
    }
    if (request.method === 'tre_version') {
      probes += 1;
      if (failing) {
        response.writeHead(503).end('{}');
        return;
      }
      response.end(JSON.stringify({ result: '4.8.2-oz-tron' }));
      return;
    }
    if (request.method === 'tre_setNextBlockTimestamp') {
      timestamp = Number(request.params[0]) / 1000;
    }
    response.end(
      JSON.stringify({
        result: request.method === 'tre_snapshot' ? '0x1' : true,
      }),
    );
  });
  const connection = runtime(url);
  async function fixture() {
    return { ready: true };
  }
  const failed = await Promise.allSettled([
    connection.helpers.loadFixture(fixture),
    connection.helpers.time.increase(12),
  ]);
  assert.ok(
    failed.every(
      (result) =>
        result.status === 'rejected' && /HTTP 503/.test(result.reason.message),
    ),
  );
  assert.equal(probes, 1);
  failing = false;
  const [value, increased] = await Promise.all([
    connection.helpers.loadFixture(fixture),
    connection.helpers.time.increase(12),
  ]);
  assert.deepEqual(value, { ready: true });
  assert.equal(increased, 1012);
  assert.equal(await connection.helpers.time.increase(0), 1012);
  assert.equal(probes, 2);
});

test('only a definitive capability answer is cached', async (t) => {
  let answer = { error: { code: -32000, message: 'temporarily unavailable' } };
  let probes = 0;
  const url = await node(t, (_path, _request, response) => {
    probes += 1;
    response.end(JSON.stringify(answer));
  });
  const connection = runtime(url);
  for (const invalid of [answer, null, [], {}, { result: '' }]) {
    answer = invalid;
    await assert.rejects(
      connection.helpers.time.increase(1),
      /Invalid tre_version/,
    );
  }
  assert.equal(probes, 5);
  answer = { error: { code: -32601, message: 'Method not found' } };
  await assert.rejects(
    connection.helpers.time.increase(1),
    /requires the patched/,
  );
  await assert.rejects(
    connection.helpers.time.increase(1),
    /requires the patched/,
  );
  async function fixture() {
    throw new Error('Unsupported fixture must not execute');
  }
  await assert.rejects(
    connection.helpers.loadFixture(fixture),
    /requires patched TRE/,
  );
  assert.equal(probes, 6);
});

test('runtime identities remain stable and owned teardown invalidates aliases', async (t) => {
  let id = '0x' + 'a'.repeat(64);
  let failing = false;
  let probes = 0;
  const url = await node(t, (_path, _request, response) => {
    probes += 1;
    if (failing) {
      response.writeHead(503).end('{}');
    } else {
      response.end(JSON.stringify({ result: id }));
    }
  });
  const removed = [];
  const lifecycle = core.createLifecycle({
    process: {
      spawnSync(command, args) {
        removed.push([command, ...args]);
        return { status: 0 };
      },
    },
  });
  lifecycle._setLaunchedForTests(url, 'owned-tre');
  const connection = runtime(url, lifecycle);
  assert.deepEqual(
    await Promise.all(
      Array.from({ length: 6 }, () => connection.tre.instanceId()),
    ),
    Array(6).fill(id),
  );
  assert.equal(probes, 1);
  failing = true;
  assert.equal(await connection.tre.instanceId(), id);
  assert.equal(probes, 1);
  failing = false;
  const alias = runtime(url.replace('127.0.0.1', 'localhost'), lifecycle);
  assert.equal(await alias.tre.instanceId(), id);
  assert.equal(probes, 2);
  lifecycle.associateOwnedUrl(
    'owned-tre',
    url.replace('127.0.0.1', 'localhost'),
  );
  lifecycle.teardown('owned-tre');
  assert.deepEqual(removed, [['docker', 'rm', '-f', 'owned-tre']]);
  id = '0x' + 'b'.repeat(64);
  assert.equal(await connection.tre.instanceId(), id);
  assert.equal(await alias.tre.instanceId(), id);
  assert.equal(probes, 4);
});

test('identity caching separates credentials and unrelated live nodes survive teardown', async (t) => {
  const probes = [];
  const url = await node(t, (_path, _request, response, headers) => {
    const tenant = headers['x-tenant'];
    probes.push(tenant);
    response.end(JSON.stringify({ result: '0x' + tenant.repeat(64) }));
  });
  const lifecycle = core.createLifecycle({
    process: { spawnSync: () => ({ status: 0 }) },
  });
  const first = runtime(url, lifecycle, { 'X-Tenant': 'a' });
  const equivalent = runtime(url, lifecycle, { 'x-tenant': 'a' });
  const second = runtime(url, lifecycle, { 'X-Tenant': 'b' });
  assert.equal(await first.tre.instanceId(), '0x' + 'a'.repeat(64));
  assert.equal(await equivalent.tre.instanceId(), '0x' + 'a'.repeat(64));
  assert.equal(await second.tre.instanceId(), '0x' + 'b'.repeat(64));
  lifecycle._setLaunchedForTests(
    'http://127.0.0.1:9999/jsonrpc',
    'unrelated-node',
  );
  lifecycle.teardown('unrelated-node');
  assert.equal(await first.tre.instanceId(), '0x' + 'a'.repeat(64));
  assert.deepEqual(probes, ['a', 'b']);
});

test('evicted identity resolutions cannot overwrite or detach a new in-flight lookup', async (t) => {
  const firstStarted = Promise.withResolvers();
  const secondStarted = Promise.withResolvers();
  let calls = 0;
  const url = await node(t, (_path, _request, response) => {
    calls += 1;
    (calls === 1 ? firstStarted : secondStarted).resolve(response);
  });
  const lifecycle = core.createLifecycle({
    process: { spawnSync: () => ({ status: 0 }) },
  });
  lifecycle._setLaunchedForTests(url, 'owned-node');
  const connection = runtime(url, lifecycle);
  const first = connection.tre.instanceId();
  const firstResponse = await firstStarted.promise;
  lifecycle.teardown('owned-node');
  const second = connection.tre.instanceId();
  const secondResponse = await secondStarted.promise;
  firstResponse.end(JSON.stringify({ result: '0x' + 'a'.repeat(64) }));
  assert.equal(await first, '0x' + 'a'.repeat(64));
  const joined = connection.tre.instanceId();
  secondResponse.end(JSON.stringify({ result: '0x' + 'b'.repeat(64) }));
  assert.deepEqual(
    await Promise.all([second, joined, connection.tre.instanceId()]),
    Array(3).fill('0x' + 'b'.repeat(64)),
  );
  assert.equal(calls, 2);
});

test('temporary identity RPC errors never become a permanent fallback', async (t) => {
  let failing = true;
  let probes = 0;
  const url = await node(t, (_path, _request, response) => {
    probes += 1;
    response.end(
      JSON.stringify(
        failing
          ? { error: { code: -32000, message: 'temporarily unavailable' } }
          : { result: '0x' + 'c'.repeat(64) },
      ),
    );
  });
  const lifecycle = core.createLifecycle({
    process: { spawnSync: () => ({ status: 1 }) },
  });
  const connection = runtime(url, lifecycle);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    assert.equal(await connection.tre.instanceId(), 'genesis-fallback');
  }
  assert.equal(probes, 8);
  failing = false;
  assert.equal(await connection.tre.instanceId(), '0x' + 'c'.repeat(64));
  assert.equal(await connection.tre.instanceId(), '0x' + 'c'.repeat(64));
  assert.equal(probes, 9);
});

test('identity retries use the same credential snapshot as the cache key', async (t) => {
  const headers = { 'X-Tenant': 'a' };
  const probes = [];
  const url = await node(t, (_path, _request, response, received) => {
    probes.push(received['x-tenant']);
    if (probes.length === 1) {
      headers['X-Tenant'] = 'b';
      response.writeHead(503).end('{}');
    } else {
      response.end(
        JSON.stringify({ result: '0x' + received['x-tenant'].repeat(64) }),
      );
    }
  });
  const connection = runtime(url, undefined, headers);
  assert.equal(await connection.tre.instanceId(), '0x' + 'a'.repeat(64));
  headers['X-Tenant'] = 'a';
  assert.equal(await connection.tre.instanceId(), '0x' + 'a'.repeat(64));
  headers['X-Tenant'] = 'b';
  assert.equal(await connection.tre.instanceId(), '0x' + 'b'.repeat(64));
  assert.deepEqual(probes, ['a', 'a', 'b']);
});
