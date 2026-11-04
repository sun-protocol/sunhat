import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Interface, Typed } from 'ethers';
import { TronWeb } from 'tronweb';
import core from '../vendor/hardhat-tron/index.js';

const recipient = '0x' + '3'.repeat(40);
const impersonatedAddress = '0x' + '4'.repeat(40);
const iface = new Interface([
  'function read(uint256 value) view returns (uint256)',
  'function write(uint256 value) payable returns (uint256)',
  'error Denied(uint256 value)',
]);

async function fixture(t, accounts = ['1'.padStart(64, '0')]) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const runtime = core.createRuntime({
    artifacts: {
      readArtifact: async () => ({
        abi: JSON.parse(iface.formatJson()),
        bytecode: '0x6000',
      }),
    },
    config: { paths: { root, artifacts: root }, tre: {} },
    network: {
      name: 'tre',
      config: {
        tron: true,
        url: 'http://127.0.0.1:9090/jsonrpc',
        accounts,
      },
      provider: {
        request: async () => assert.fail('Unexpected forwarded RPC'),
      },
    },
  });
  const state = {
    requests: [],
    response: {
      result: { result: true },
      energy_used: 123456,
      constant_result: ['7'.padStart(64, '0')],
    },
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).pathname, '/wallet/triggerconstantcontract');
    state.requests.push(JSON.parse(options.body));
    return Response.json(state.response);
  });
  const contract = await runtime.ethers.getContractAt('Fixture', recipient);
  const [signer] = await runtime.ethers.getSigners();
  const tx = {
    from: signer?.address,
    to: recipient,
    data: iface.encodeFunctionData('write', [9n]),
    value: 7n,
  };
  const entries = [
    () => contract.read.estimateGas(9n),
    () => contract.write.estimateGas(9n, Typed.overrides({ value: 7n })),
    () => runtime.ethers.provider.estimateGas(tx),
    async () =>
      BigInt(
        await runtime.request(
          { method: 'eth_estimateGas', params: [{ ...tx, value: '0x7' }] },
          async () => assert.fail('Unexpected RPC forwarding'),
        ),
      ),
  ];
  return { runtime, contract, signer, tx, entries, state };
}

test('all estimate entries use exact node energy including zero', async (t) => {
  const { entries, state } = await fixture(t);
  for (const value of [0, 123456, '9007199254740993']) {
    state.response.energy_used = value;
    for (const estimate of entries) {
      assert.equal(await estimate(), BigInt(value));
    }
  }
  for (const value of [undefined, null, -1, 1.5, true, {}, 'bad', '-1']) {
    state.response.energy_used = value;
    for (const estimate of entries) {
      await assert.rejects(estimate(), /energy_used/);
    }
  }
});

test('estimates preserve sender, calldata, native value and impersonated identity', async (t) => {
  const { runtime, contract, signer, tx, state } = await fixture(t);
  await contract.write.estimateGas(9n, { value: 7n });
  assert.equal(state.requests.at(-1).call_value, 7);
  await runtime.ethers.provider.estimateGas({ ...tx, from: undefined });
  assert.equal(
    state.requests.at(-1).owner_address.toLowerCase(),
    TronWeb.address.toHex(signer.address).toLowerCase(),
  );
  assert.equal(
    state.requests.at(-1).owner_address.toLowerCase(),
    TronWeb.address.toHex(signer.address).toLowerCase(),
  );
  const impersonated = await runtime.ethers.getSigner(impersonatedAddress);
  await contract.connect(impersonated).write.estimateGas(9n, { value: 11n });
  assert.equal(
    state.requests.at(-1).owner_address.toLowerCase(),
    TronWeb.address.toHex(impersonatedAddress).toLowerCase(),
  );
  assert.equal(state.requests.at(-1).call_value, 11);
  await runtime.ethers.provider.estimateGas({
    ...tx,
    from: Promise.resolve(signer.address),
    to: { getAddress: async () => recipient },
  });
  assert.equal(state.requests.at(-1).data, tx.data.slice(2));
  assert.equal(state.requests.at(-1).call_value, 7);
  const before = state.requests.length;
  await assert.rejects(
    runtime.ethers.provider.estimateGas({ data: '0x6000' }),
    (error) => error.code === 'UNSUPPORTED_OPERATION',
  );
  assert.equal(state.requests.length, before);
});

test('estimation cannot turn malformed results, reverts or transport errors into a guessed limit', async (t) => {
  const { entries, state } = await fixture(t);
  for (const result of [undefined, null, [], {}, { result: 'true' }]) {
    state.response.result = result;
    for (const estimate of entries) {
      await assert.rejects(estimate(), /constant-call/);
    }
  }
  const data = iface.encodeErrorResult('Denied', [42n]);
  state.response = {
    result: { result: false, code: 'CONTRACT_EXE_ERROR' },
    energy_used: 55,
    constant_result: [data.slice(2)],
  };
  for (const estimate of entries) {
    await assert.rejects(
      estimate(),
      (error) => error.code === 'CALL_EXCEPTION' && error.data === data,
    );
  }
  const original = new Error('EXPECTED_ESTIMATION_TRANSPORT_FAILURE');
  t.mock.method(globalThis, 'fetch', async () => {
    throw original;
  });
  for (const estimate of entries) {
    await assert.rejects(estimate(), (error) => error === original);
  }
});

test('facade estimates validate bound and impersonated from before any HTTP request', async (t) => {
  const { runtime, contract, signer, state } = await fixture(t);
  for (const wrap of [(value) => value, Typed.overrides]) {
    await contract.write.estimateGas(9n, wrap({ from: null }));
    await contract.write.estimateGas(9n, wrap({ from: signer.address }));
    const before = state.requests.length;
    await assert.rejects(
      contract.write.estimateGas(9n, wrap({ from: impersonatedAddress })),
      /from mismatch/,
    );
    assert.equal(state.requests.length, before);
    const impersonated = await runtime.ethers.getSigner(impersonatedAddress);
    await contract
      .connect(impersonated)
      .write.estimateGas(9n, wrap({ from: impersonatedAddress }));
    const after = state.requests.length;
    await assert.rejects(
      contract
        .connect(impersonated)
        .write.estimateGas(9n, wrap({ from: signer.address })),
      /from mismatch/,
    );
    assert.equal(state.requests.length, after);
  }
  state.response.constant_result = ['ff'];
  assert.equal(await contract.read.estimateGas(9n), 123456n);
});

test('read-only connections can estimate using an explicit sender', async (t) => {
  const { runtime, contract, tx, state } = await fixture(t, []);
  await runtime.ethers.provider.estimateGas({
    ...tx,
    from: impersonatedAddress,
  });
  await contract.write.estimateGas(9n, { from: impersonatedAddress });
  for (const request of state.requests) {
    assert.equal(
      request.owner_address.toLowerCase(),
      TronWeb.address.toHex(impersonatedAddress).toLowerCase(),
    );
  }
});
