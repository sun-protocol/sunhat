import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import core from '../vendor/hardhat-tron/index.js';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

function context(root, key, chainId, url = 'http://127.0.0.1:9090/jsonrpc') {
  return {
    config: { paths: { root, artifacts: resolve(root, 'artifacts') }, tre: {} },
    network: {
      name: `tre-${chainId}`,
      config: {
        tron: true,
        url,
        accounts: [key.toString(16).padStart(64, '0')],
      },
      provider: { request: async () => `0x${chainId.toString(16)}` },
    },
  };
}

test('TRON providers, configured signers and artifacts remain connection-local', async (t) => {
  const temporary = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-isolation-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const runtimes = [1, 2].map((index) => {
    const root = resolve(temporary, String(index));
    const artifact = resolve(root, 'artifacts', 'contracts', 'Counter.sol');
    mkdirSync(artifact, { recursive: true });
    writeFileSync(
      resolve(artifact, 'Counter.json'),
      JSON.stringify({
        contractName: 'Counter',
        sourceName: 'contracts/Counter.sol',
        abi: [`function value${index}() view returns (uint256)`],
        bytecode: '0x00',
      }),
    );
    return core.createRuntime(context(root, index, index));
  });
  const [first, second] = runtimes;
  const [a, b] = await Promise.all(
    runtimes.map((runtime) => runtime.ethers.getSigners()),
  );
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.notEqual(a[0].address, b[0].address);
  assert.notEqual(a[0].provider, b[0].provider);
  assert.equal((await first.ethers.provider.getNetwork()).chainId, 1n);
  assert.equal((await second.ethers.provider.getNetwork()).chainId, 2n);
  const factoryA = await first.ethers.getContractFactory('Counter');
  const factoryB = await second.ethers.getContractFactory('Counter');
  assert.ok(factoryA.interface.getFunction('value1'));
  assert.equal(factoryA.interface.getFunction('value2'), null);
  assert.ok(factoryB.interface.getFunction('value2'));
});

test('native factory and contract entries preserve the selected signing account', async (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-signers-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = resolve(root, 'artifacts/contracts/SignerFixture.sol');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, 'SignerFixture.json'),
    JSON.stringify({
      contractName: 'SignerFixture',
      abi: [
        {
          type: 'function',
          name: 'touch',
          stateMutability: 'nonpayable',
          inputs: [],
          outputs: [],
        },
      ],
      bytecode: '0x00',
    }),
  );
  const input = context(root, 1, 1);
  input.network.config.accounts.push('2'.padStart(64, '0'));
  const runtime = core.createRuntime(input);
  const [first, second] = await runtime.ethers.getSigners();
  const address = '41' + '3'.repeat(40);
  const txId = '4'.repeat(64);
  const operations = [];
  const signingAccounts = [];
  const clients = new Set([
    runtime.tre.makeTronWeb().tronWeb,
    first.tronWeb,
    second.tronWeb,
  ]);
  for (const client of clients) {
    client.transactionBuilder.createSmartContract = async (_, owner) => {
      operations.push(['deploy', client.address.toHex(owner).toLowerCase()]);
      return { txID: txId, contract_address: address };
    };
    client.transactionBuilder.triggerSmartContract = async (
      _address,
      _selector,
      _options,
      _parameters,
      owner,
    ) => {
      operations.push(['call', owner.toLowerCase()]);
      return { result: { result: true }, transaction: { txID: txId } };
    };
    client.trx.sign = async (transaction) => {
      signingAccounts.push(client.defaultAddress.hex.toLowerCase());
      return { ...transaction, signature: ['test-signature'] };
    };
    client.trx.sendRawTransaction = async () => ({ result: true, txid: txId });
  }
  const receipt = {
    id: txId,
    blockNumber: 1,
    contract_address: address,
    receipt: { result: 'SUCCESS' },
  };
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(
      String(url),
      'http://127.0.0.1:9090/wallet/gettransactioninfobyid',
    );
    return new Response(JSON.stringify(receipt));
  });
  const { ethers } = runtime;
  const runner = (await ethers.getContractAt('SignerFixture', address, second))
    .runner;
  for (const [name, createFactory, signer] of [
    ['default', () => ethers.getContractFactory('SignerFixture'), first],
    [
      'empty options',
      () => ethers.getContractFactory('SignerFixture', {}),
      first,
    ],
    [
      'explicit',
      () => ethers.getContractFactory('SignerFixture', second),
      second,
    ],
    [
      'options',
      () => ethers.getContractFactory('SignerFixture', { signer: second }),
      second,
    ],
    [
      'connected',
      async () =>
        (await ethers.getContractFactory('SignerFixture')).connect(second),
      second,
    ],
    [
      'native runner',
      () => ethers.getContractFactory('SignerFixture', runner),
      second,
    ],
    [
      'connected native runner',
      async () =>
        (await ethers.getContractFactory('SignerFixture')).connect(runner),
      second,
    ],
  ]) {
    await t.test(`factory ${name}`, async () => {
      const expected = signer.tronWeb.defaultAddress.hex.toLowerCase();
      const factory = await createFactory();
      const deployed = await factory.deploy();
      assert.deepEqual(operations.at(-1), ['deploy', expected]);
      assert.equal(signingAccounts.at(-1), expected);
      await (await deployed.touch()).wait();
      assert.deepEqual(operations.at(-1), ['call', expected]);
      assert.equal(signingAccounts.at(-1), expected);
      await (await factory.attach(address).touch()).wait();
      assert.deepEqual(operations.at(-1), ['call', expected]);
      assert.equal(signingAccounts.at(-1), expected);
    });
  }
  for (const [name, signer] of [
    ['default', undefined],
    ['explicit', second],
    ['native runner', runner],
  ]) {
    await t.test(`contract ${name}`, async () => {
      const attached = await ethers.getContractAt(
        'SignerFixture',
        address,
        signer,
      );
      await (await attached.touch()).wait();
      assert.deepEqual(operations.at(-1), [
        'call',
        (signer ?? first).tronWeb.defaultAddress.hex.toLowerCase(),
      ]);
      await (await attached.connect(first).touch()).wait();
      assert.deepEqual(operations.at(-1), [
        'call',
        first.tronWeb.defaultAddress.hex.toLowerCase(),
      ]);
    });
  }
  await t.test(
    'unsupported explicit signers never fall back to the default account',
    async () => {
      const unsupported = new ethers.Wallet('3'.padStart(64, '0'));
      const count = operations.length;
      for (const create of [
        () => ethers.getContractFactory('SignerFixture', unsupported),
        () =>
          ethers.getContractFactory('SignerFixture', { signer: unsupported }),
        () => ethers.getContractAt('SignerFixture', address, unsupported),
      ]) {
        await assert.rejects(async () => create(), /native TRON signer/);
      }
      assert.equal(operations.length, count);
    },
  );
  await t.test(
    'connect rejects detached and unsupported runners without retaining a key',
    async () => {
      const factory = await ethers.getContractFactory('SignerFixture', second);
      const contract = await ethers.getContractAt(
        'SignerFixture',
        address,
        second,
      );
      const count = operations.length;
      for (const invalid of [
        null,
        undefined,
        new ethers.Wallet('3'.padStart(64, '0')),
      ]) {
        assert.throws(() => factory.connect(invalid), /native TRON signer/);
        assert.throws(() => contract.connect(invalid), /native TRON signer/);
      }
      assert.equal(operations.length, count);
      await (await contract.touch()).wait();
      assert.deepEqual(operations.at(-1), [
        'call',
        second.tronWeb.defaultAddress.hex.toLowerCase(),
      ]);
    },
  );
});

async function nativeNode(t, patched, options = {}) {
  let snapshot = 0;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const input = JSON.parse(body);
    const result =
      input.method === 'tre_version'
        ? '4.8.2-oz-tron'
        : input.method === 'tre_revert'
          ? (options.revertResult ?? true)
          : ++snapshot;
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify(
        request.url === '/wallet/getnowblock'
          ? {
              block_header: {
                raw_data: { number: options.blockNumber?.() ?? 1 },
              },
            }
          : request.url === '/wallet/getnodeinfo'
            ? { configNodeInfo: { codeVersion: '4.8.2' } }
            : patched
              ? { result }
              : { error: { code: -32601, message: 'Method not found' } },
      ),
    );
  });
  await new Promise((resolveReady) =>
    server.listen(0, '127.0.0.1', resolveReady),
  );
  t.after(
    () =>
      new Promise((resolveClosed) => {
        server.closeAllConnections();
        server.close(resolveClosed);
      }),
  );
  return `http://127.0.0.1:${server.address().port}/jsonrpc`;
}

test('capability detection is scoped and ordinary TRE never silently reruns fixtures', async (t) => {
  const [patchedUrl, ordinaryUrl] = await Promise.all([
    nativeNode(t, true),
    nativeNode(t, false),
  ]);
  const patched = core.createRuntime(context(tmpdir(), 1, 1, patchedUrl));
  const ordinary = core.createRuntime(context(tmpdir(), 2, 2, ordinaryUrl));
  let executions = 0;
  async function fixture() {
    executions += 1;
    return { executions };
  }
  const result = await patched.helpers.loadFixture(fixture);
  assert.equal(await patched.helpers.loadFixture(fixture), result);
  assert.equal(executions, 1);
  await assert.rejects(
    ordinary.helpers.loadFixture(fixture),
    /requires patched TRE/,
  );
  assert.equal(executions, 1);
  assert.equal(await core.createLifecycle().isReachable(ordinaryUrl), true);
});

test('Docker teardown rejects cleanup failure and never removes a reused container', () => {
  const removed = [];
  const lifecycle = core.createLifecycle({
    process: {
      spawnSync(command, args) {
        removed.push([command, ...args]);
        return { status: 1, stderr: 'EXPECTED_REMOVE_FAILURE' };
      },
    },
  });
  lifecycle.teardown('external-container');
  assert.deepEqual(removed, []);
  lifecycle._setLaunchedForTests(
    'http://127.0.0.1:9090/jsonrpc',
    'owned-container',
  );
  assert.throws(
    () => lifecycle.teardown('owned-container'),
    /EXPECTED_REMOVE_FAILURE/,
  );
  assert.equal(
    lifecycle.launchedContainerFor('http://127.0.0.1:9090/jsonrpc'),
    'owned-container',
  );
});

test('compiler failures retain the original cause without loading Hardhat 2', async () => {
  const compiler = core.createCompiler();
  assert.equal(typeof compiler.compilerPath, 'function');
  const createErrors = (
    await import('../vendor/hardhat-tron/compile/errors.js')
  ).default;
  const { TronCompileError } = createErrors();
  const original = new Error('EXPECTED_DOWNLOAD_FAILURE');
  const error = new TronCompileError('Compiler download failed', original);
  assert.equal(error.message, 'Compiler download failed');
  assert.equal(error.cause, original);
});

test('native readiness waits past genesis', async (t) => {
  let height = 0;
  const url = await nativeNode(t, false, { blockNumber: () => height });
  const lifecycle = core.createLifecycle();
  assert.equal(await lifecycle.isReachable(url), false);
  height = 1;
  assert.equal(await lifecycle.isReachable(url), true);
});

test('a rejected native snapshot restore never returns cached fixture data', async (t) => {
  const url = await nativeNode(t, true, { revertResult: false });
  const runtime = core.createRuntime(context(tmpdir(), 1, 1, url));
  let executions = 0;
  async function fixture() {
    return ++executions;
  }
  assert.equal(await runtime.helpers.loadFixture(fixture), 1);
  await assert.rejects(
    runtime.helpers.loadFixture(fixture),
    /tre_revert failed/,
  );
  assert.equal(executions, 1);
});

test('native constant call preserves values above Number.MAX_SAFE_INTEGER', async (t) => {
  let sent;
  const server = createServer(async (request, response) => {
    sent = '';
    for await (const chunk of request) {
      sent += chunk;
    }
    response.end(
      JSON.stringify({ result: { result: true }, constant_result: [''] }),
    );
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  t.after(
    () =>
      new Promise((closed) => {
        server.closeAllConnections();
        server.close(closed);
      }),
  );
  const runtime = core.createRuntime(
    context(
      tmpdir(),
      1,
      1,
      `http://127.0.0.1:${server.address().port}/jsonrpc`,
    ),
  );
  await runtime.ethers.provider.call({
    to: '0x' + '1'.repeat(40),
    data: '0x',
    value: 9007199254740993n,
  });
  assert.match(sent, /"call_value":9007199254740993/);
});

test('Docker ENOENT retains its original cause with null output', async (t) => {
  const url = await nativeNode(t, false, { blockNumber: () => 0 });
  const original = Object.assign(new Error('EXPECTED_DOCKER_ENOENT'), {
    code: 'ENOENT',
  });
  const lifecycle = core.createLifecycle({
    process: {
      spawnSync: () => ({
        status: null,
        stderr: null,
        stdout: null,
        error: original,
      }),
    },
  });
  await assert.rejects(
    lifecycle.ensureUp({ image: 'test', port: 9090 }, url),
    (error) => {
      assert.equal(error.cause, original);
      assert.match(error.message, /EXPECTED_DOCKER_ENOENT/);
      return true;
    },
  );
});

test('compiler cleanup failure does not replace load failure and staging paths are unique', async (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-compiler-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const payload = 'module.exports = {};';
  const build = {
    version: '0.8.26',
    longVersion: '0.8.26+commit.test',
    path: 'soljson-v0.8.26+commit.test.js',
    sha256: '0x' + createHash('sha256').update(payload).digest('hex'),
  };
  const server = createServer((request, response) =>
    response.end(
      request.url.endsWith('list.json')
        ? JSON.stringify({ builds: [build] })
        : payload,
    ),
  );
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  t.after(
    () =>
      new Promise((closed) => {
        server.closeAllConnections();
        server.close(closed);
      }),
  );
  const leftovers = [];
  const compiler = () =>
    core.createCompiler({
      cacheDir: root,
      fs: {
        ...fs,
        rmSync(path) {
          leftovers.push(path);
          throw new Error('EXPECTED_COMPILER_CLEANUP_FAILURE');
        },
      },
    });
  const options = { mirror: `http://127.0.0.1:${server.address().port}` };
  const cachedPath = await compiler().compilerPath(
    build.longVersion,
    options.mirror,
  );
  mkdirSync(await compiler().compilerCacheDir(options.mirror), {
    recursive: true,
  });
  writeFileSync(cachedPath, payload);
  const results = await Promise.allSettled([
    compiler().getCompiler('0.8.26', options),
    compiler().getCompiler('0.8.26', options),
  ]);
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.match(result.reason.message, /failed to load tron-solc/);
    assert.ok(result.reason.cause);
  }
  assert.equal(leftovers.length, 2);
  assert.notEqual(leftovers[0], leftovers[1]);
  assert.equal(fs.readFileSync(cachedPath, 'utf8'), payload);
});

test(
  'receipt deadlines abort a node that accepts requests without replying',
  { timeout: 5000 },
  async (t) => {
    const server = createServer(() => {});
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    t.after(
      () =>
        new Promise((closed) => {
          server.closeAllConnections();
          server.close(closed);
        }),
    );
    const runtime = core.createRuntime(
      context(
        tmpdir(),
        1,
        1,
        `http://127.0.0.1:${server.address().port}/jsonrpc`,
      ),
    );
    const started = Date.now();
    await assert.rejects(
      runtime.tre.waitForReceipt(
        runtime.tre.makeTronWeb().tronWeb,
        '1'.repeat(64),
        { timeout: 40 },
      ),
    );
    assert.ok(
      Date.now() - started < 2000,
      'The outer receipt budget must bound the in-flight request',
    );
  },
);
