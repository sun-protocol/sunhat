import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import core from '../vendor/hardhat-tron/index.js';
import transport from '../vendor/hardhat-tron/runtime/transport.js';
import createCheatcodes from '../vendor/hardhat-tron/runtime/cheatcodes.js';

const address = '0x' + '1'.repeat(40);
const root = fileURLToPath(new URL('../', import.meta.url));
function runtime(url = 'http://127.0.0.1:9090/jsonrpc', httpHeaders = {}) {
  return core.createRuntime({
    config: { paths: { root, artifacts: root }, tre: { fundSigners: false } },
    network: {
      name: 'tre',
      config: {
        tron: true,
        url,
        httpHeaders,
        timeout: 1000,
        accounts: ['1'.padStart(64, '0')],
      },
      provider: { request: async () => '0x1' },
    },
  });
}

test('state reads distinguish transport, HTTP and protocol failures from actual zero', async (t) => {
  const { provider } = runtime().ethers;
  const original = new Error('EXPECTED_CONNECTION_FAILURE');
  let response = () => {
    throw original;
  };
  t.mock.method(globalThis, 'fetch', async () => response());
  for (const read of [
    () => provider.getBalance(address),
    () => provider.getStorage(address, 0),
  ]) {
    await assert.rejects(read, (error) => error === original);
    response = () => new Response('unavailable', { status: 503 });
    await assert.rejects(read, /HTTP 503/);
    response = () => new Response('{');
    await assert.rejects(read, SyntaxError);
    for (const invalid of [
      null,
      [],
      { error: { code: -32000 } },
      { message: 'invalid response' },
    ]) {
      response = () => Response.json(invalid);
      await assert.rejects(read, /Invalid TRON/);
    }
    response = () => {
      throw original;
    };
  }
  for (const balance of [-1, 1.5, null, 'bad']) {
    response = () => Response.json({ balance });
    await assert.rejects(
      () => provider.getBalance(address),
      /Invalid TRON account balance/,
    );
  }
  for (const account of [
    {},
    { balance: 0 },
    { address: '41' + address.slice(2) },
  ]) {
    response = () => Response.json(account);
    assert.equal(await provider.getBalance(address), 0n);
  }
  response = () => new Response('{"balance":9007199254740993}');
  assert.equal(await provider.getBalance(address), 9007199254740993n);
  response = () => Response.json({ result: '0x' });
  assert.equal(await provider.getStorage(address, 0), '0x' + '0'.repeat(64));
  response = () => Response.json({ result: '0x01' });
  assert.equal(
    await provider.getStorage(address, 0),
    '0x' + '0'.repeat(63) + '1',
  );
  response = () => Response.json({});
  await assert.rejects(
    () => provider.getStorage(address, 0),
    /Invalid TRON storage/,
  );
});

test('uncertain mutations are never replayed while explicit reads may retry', async (t) => {
  const { rpcCall } = createCheatcodes();
  const client = runtime().tre.makeTronWeb().tronWeb;
  let applied = 0;
  const original = new TypeError('fetch failed');
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.redirect, 'error');
    applied++;
    throw original;
  });
  for (const method of [
    'tre_mine',
    'tre_snapshot',
    'tre_revert',
    'tre_unknown',
  ]) {
    applied = 0;
    await assert.rejects(
      () => rpcCall(client, method),
      (error) => error === original,
    );
    assert.equal(applied, 1);
  }
  applied = 0;
  await assert.rejects(
    () => rpcCall(client, 'tre_version'),
    (error) => error === original,
  );
  assert.equal(applied, 2);
});

test('native, SDK and readiness requests retain proxy paths, query and authentication', async (t) => {
  const seen = [];
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) {
      text += chunk;
    }
    const url = new URL(request.url, 'http://localhost');
    seen.push({
      path: url.pathname,
      query: url.search,
      token: request.headers['x-api-key'],
    });
    if (request.headers['x-api-key'] !== 'test-token') {
      response.writeHead(401).end('{}');
      return;
    }
    assert.equal(request.headers['content-type'], 'application/json');
    response.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/wallet/getnodeinfo')) {
      response.end(JSON.stringify({ configNodeInfo: { codeVersion: 'test' } }));
    } else if (url.pathname.endsWith('/wallet/getnowblock')) {
      response.end(
        JSON.stringify({
          blockID: '1'.repeat(64),
          block_header: { raw_data: { number: 1, timestamp: 1000 } },
        }),
      );
    } else if (url.pathname.endsWith('/getaccount')) {
      response.end('{"balance":7}');
    } else if (url.pathname.endsWith('/tre')) {
      assert.equal(JSON.parse(text).method, 'tre_version');
      response.end('{"result":"test-oz-tron"}');
    } else {
      response.writeHead(404).end('{}');
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((done) => server.close(done));
  });
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/gateway/private-segment/jsonrpc/?api-key=secret#fragment`;
  const headers = {
    'X-API-Key': 'test-token',
    'Content-Type': 'application/json',
  };
  const context = runtime(url, headers);
  assert.equal(
    await core.createLifecycle().isReachable(url, 1000, headers),
    true,
  );
  assert.equal(await context.ethers.provider.getBalance(address), 7n);
  const [signer] = await context.ethers.getSigners();
  assert.equal(await signer.tronWeb.trx.getBalance(signer.tronAddress), 7);
  assert.equal(
    (await createCheatcodes().rpcCall(signer.tronWeb, 'tre_version')).result,
    'test-oz-tron',
  );
  assert.ok(seen.length >= 5);
  assert.ok(
    seen.every((entry) => entry.path.startsWith('/gateway/private-segment/')),
  );
  assert.ok(
    seen.every(
      (entry) =>
        entry.query === '?api-key=secret' && entry.token === 'test-token',
    ),
  );
  const nested = runtime(
    url.replace('/gateway/private-segment/', '/gateway/jsonrpc/'),
    headers,
  );
  assert.equal(await nested.ethers.provider.getBalance(address), 7n);
  const [nestedSigner] = await nested.ethers.getSigners();
  assert.equal(
    await nestedSigner.tronWeb.trx.getBalance(nestedSigner.tronAddress),
    7,
  );
  assert.ok(
    seen.slice(-2).every((entry) => entry.path.startsWith('/gateway/jsonrpc/')),
  );
  await assert.rejects(
    () =>
      runtime(url, { 'X-API-Key': 'wrong' }).ethers.provider.getBalance(
        address,
      ),
    /HTTP 401/,
  );
  await assert.rejects(
    () => core.createLifecycle().isReachable(url, 1000, {}),
    /HTTP 401/,
  );
});

test('endpoint diagnostics omit userinfo, path and query credentials', () => {
  const url =
    'https://user:password@rpc.example/private-token/jsonrpc?api-key=query-token';
  assert.equal(transport.describeEndpoint(url), 'https://rpc.example');
  assert.equal(
    transport.endpointUrl(url, '/wallet/getaccount').href,
    'https://user:password@rpc.example/private-token/wallet/getaccount?api-key=query-token',
  );
});

test('mutating requests do not follow redirects in native or SDK transport', async (t) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(307, { Location: '/replay' }).end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((done) => server.close(done));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(() =>
    transport.requestJson(url, '/tre', { body: '{}' }),
  );
  assert.equal(requests, 1);
  await assert.rejects(() =>
    transport
      .createHttpProvider(url)
      .request('/wallet/broadcasttransaction', { txID: 'test' }, 'post'),
  );
  assert.equal(requests, 2);
});

test('URL credentials become authentication headers without entering fetch URLs', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).username, '');
    assert.equal(new URL(url).password, '');
    assert.equal(
      options.headers.get('Authorization'),
      'Basic ' + Buffer.from('user:password').toString('base64'),
    );
    return Response.json({});
  });
  await transport.requestJson(
    'https://user:password@rpc.example/api/jsonrpc?key=test',
    '/wallet/getaccount',
  );
});

test('disabled timeouts and case-insensitive header overrides match SDK semantics', async (t) => {
  const server = createServer(async (request, response) => {
    await new Promise((done) => setTimeout(done, 20));
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(request.headers['x-api-key'], 'override');
    response.setHeader('Content-Type', 'application/json');
    response.end('{"balance":7}');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((done) => server.close(done));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const provider = transport.createHttpProvider(url, 0, {
    'X-API-Key': 'original',
    'Content-Type': 'application/json',
  });
  assert.equal(
    (
      await transport.requestJson(
        { fullNode: provider },
        '/wallet/getaccount',
        { body: '{}', headers: { 'x-api-key': 'override' } },
      )
    ).balance,
    7,
  );
  const sdk = transport.createHttpProvider(url, 0, {
    'X-API-Key': 'override',
    'Content-Type': 'application/json',
  });
  assert.equal(
    (await sdk.request('/wallet/getaccount', {}, 'post')).balance,
    7,
  );
});

test(
  'HTTP failure cancels an unfinished body without hiding the original error',
  { timeout: 3000 },
  async (t) => {
    let closed;
    const closure = new Promise((done) => {
      closed = done;
    });
    const server = createServer((_request, response) => {
      response.on('close', closed);
      response.writeHead(503, { 'Content-Type': 'text/plain' });
      response.write('unavailable');
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    t.after(() => {
      server.closeAllConnections();
      return new Promise((done) => server.close(done));
    });
    const client = {
      fullNode: transport.createHttpProvider(
        `http://127.0.0.1:${server.address().port}`,
        0,
      ),
    };
    await assert.rejects(
      () => transport.requestJson(client, '/wallet/getaccount'),
      (error) => error.status === 503,
    );
    await closure;
    const cleanup = new Error('EXPECTED_BODY_CLEANUP_FAILURE');
    const diagnostics = [];
    t.mock.method(console, 'error', (...args) => diagnostics.push(args));
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 503,
      body: {
        cancel: async () => {
          throw cleanup;
        },
      },
    }));
    await assert.rejects(
      () => transport.requestJson(client, '/wallet/getaccount'),
      (error) => error.status === 503,
    );
    assert.equal(diagnostics[0][1], cleanup);
  },
);

test(
  'native and SDK requests enforce the same configured timeout through response bodies',
  { timeout: 5000 },
  async (t) => {
    const seen = [];
    const server = createServer((request, response) => {
      seen.push(request.url);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{');
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    t.after(() => {
      server.closeAllConnections();
      return new Promise((done) => server.close(done));
    });
    const url = `http://127.0.0.1:${server.address().port}/jsonrpc`;
    const client = { fullNode: transport.createHttpProvider(url, 30) };
    await assert.rejects(
      transport.requestJson(client, '/wallet/getaccount', {
        signal: AbortSignal.timeout(1000),
      }),
    );
    await assert.rejects(
      client.fullNode.request('/wallet/getaccount', {}, 'post'),
    );
    await assert.rejects(createCheatcodes().rpcCall(client, 'tre_mine'));
    assert.equal(seen.filter((path) => path === '/tre').length, 1);
    client.fullNode = transport.createHttpProvider(url, 0);
    await assert.rejects(
      transport.requestJson(client, '/wallet/getaccount', {
        signal: AbortSignal.timeout(30),
      }),
    );
    const before = seen.length;
    await assert.rejects(
      transport.requestJson(client, '/wallet/getaccount', {
        signal: AbortSignal.abort(new Error('EXPECTED_CANCEL')),
      }),
      /EXPECTED_CANCEL/,
    );
    assert.equal(seen.length, before);
  },
);

test(
  'receipt recovery mining and read backoff cannot extend the operation deadline',
  { timeout: 5000 },
  async (t) => {
    const seen = [];
    const server = createServer((request, response) => {
      seen.push(request.url);
      if (request.url === '/tre') {
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end('{}');
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    t.after(() => {
      server.closeAllConnections();
      return new Promise((done) => server.close(done));
    });
    const connection = runtime(
      `http://127.0.0.1:${server.address().port}/jsonrpc`,
    );
    const client = connection.tre.makeTronWeb().tronWeb;
    client.fullNode.timeout = 0;
    const started = Date.now();
    await assert.rejects(
      connection.tre.waitForReceipt(client, 'a'.repeat(64), { timeout: 300 }),
    );
    assert.ok(Date.now() - started < 1500);
    assert.equal(seen.filter((path) => path === '/tre').length, 1);
    const count = seen.length;
    await new Promise((done) => setTimeout(done, 30));
    assert.equal(seen.length, count);

    const original = new TypeError('fetch failed');
    let reads = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      reads++;
      throw original;
    });
    await assert.rejects(
      connection.tre.waitForReceipt(client, 'a'.repeat(64), { timeout: 20 }),
      (error) => error === original,
    );
    assert.equal(reads, 1);
  },
);

test('expired provider waits cannot start a late native transaction lookup', async (t) => {
  const connection = runtime();
  const waitForReceipt = connection.tre.waitForReceipt;
  t.mock.method(connection.tre, 'waitForReceipt', async () => {
    await new Promise((done) => setTimeout(done, 30));
    return { id: 'a'.repeat(64), blockNumber: 1 };
  });
  t.mock.method(globalThis, 'fetch', async () =>
    assert.fail('Expired wait started HTTP'),
  );
  await assert.rejects(
    connection.ethers.provider.waitForTransaction('a'.repeat(64), 1, 10),
    (error) => error.name === 'TimeoutError',
  );
  for (const timeout of [-1, 1.5, Infinity, 2147483648]) {
    assert.throws(
      () => transport.createHttpProvider('http://127.0.0.1', timeout),
      /TRON timeout/,
    );
  }
  await assert.rejects(
    waitForReceipt(connection.tre.makeTronWeb().tronWeb, 'a'.repeat(64), {
      timeout: 0,
    }),
  );
});

test(
  'SDK deadlines also bound a response that continuously sends body chunks',
  { timeout: 3000 },
  async (t) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{');
      const interval = setInterval(() => response.write(' '), 10);
      response.on('close', () => clearInterval(interval));
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    t.after(() => {
      server.closeAllConnections();
      return new Promise((done) => server.close(done));
    });
    const provider = transport.createHttpProvider(
      `http://127.0.0.1:${server.address().port}`,
      50,
    );
    const started = Date.now();
    await assert.rejects(provider.request('/wallet/getaccount', {}, 'post'));
    assert.ok(Date.now() - started < 1000);
  },
);

test(
  'cancellation during recovery mining preserves the original reason',
  { timeout: 3000 },
  async (t) => {
    const controller = new AbortController();
    const reason = new Error('EXPECTED_RECOVERY_CANCELLATION');
    let mines = 0;
    const server = createServer((request, response) => {
      if (request.url === '/tre') {
        mines++;
        controller.abort(reason);
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end('{}');
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    t.after(() => {
      server.closeAllConnections();
      return new Promise((done) => server.close(done));
    });
    const connection = runtime(
      `http://127.0.0.1:${server.address().port}/jsonrpc`,
    );
    await assert.rejects(
      connection.tre.waitForReceipt(
        connection.tre.makeTronWeb().tronWeb,
        'a'.repeat(64),
        { timeout: 1000, signal: controller.signal },
      ),
      (error) => error === reason,
    );
    assert.equal(mines, 1);
  },
);
