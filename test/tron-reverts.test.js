import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { Interface, AbiCoder, ZeroAddress, toBeHex } from 'ethers';
import { TronWeb } from 'tronweb';
import core from '../vendor/hardhat-tron/index.js';

const address = '0x' + '1'.repeat(40);
const txId = '2'.repeat(64);
const iface = new Interface([
  'function check(address candidate) view returns (bool)',
  'function calculate(address candidate) view returns (uint256)',
  'function predict(address candidate) view returns (address)',
  'function pay(address candidate) payable returns (address)',
  'function write() returns (address)',
  'function writeTuple((uint256 value) payload) returns (address)',
  'error Deliberate(uint256 value)',
  'error FailedCall()',
  'error FailedDeployment()',
]);
const revertResponse = (data = '0x') => ({
  result: { result: false, code: 'CONTRACT_EXE_ERROR' },
  constant_result: [data.slice(2)],
});

async function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-reverts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = resolve(root, 'artifacts/contracts/RevertFixture.sol');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, 'RevertFixture.json'),
    JSON.stringify({
      contractName: 'RevertFixture',
      abi: JSON.parse(iface.formatJson()).map((entry) =>
        entry.type === 'function'
          ? { ...entry, stateMutability: entry.stateMutability ?? 'nonpayable' }
          : entry,
      ),
      bytecode: '0x00',
    }),
  );
  const runtime = core.createRuntime({
    config: { paths: { root, artifacts: resolve(root, 'artifacts') }, tre: {} },
    network: {
      name: 'tre',
      config: {
        tron: true,
        url: 'http://127.0.0.1:9090/jsonrpc',
        accounts: ['1'.padStart(64, '0')],
      },
      provider: { request: async () => '0x1' },
    },
  });
  const state = {
    response: revertResponse(),
    receipt: {
      id: txId,
      blockNumber: 1,
      receipt: { result: 'REVERT' },
      contractResult: [''],
    },
    bytecode: '60006000fd63d6bda27563b06ebf3d',
    sendError: undefined,
    simulationError: undefined,
    codeReads: 0,
    simulations: 0,
  };
  const [signer] = await runtime.ethers.getSigners();
  for (const client of new Set([
    runtime.tre.makeTronWeb().tronWeb,
    signer.tronWeb,
  ])) {
    client.trx.getContract = async () => {
      state.codeReads++;
      return { bytecode: state.bytecode };
    };
    client.transactionBuilder.triggerSmartContract = async (
      _address,
      _selector,
      options,
    ) => {
      if (options._isConstant) {
        return state.response;
      }
      if (state.sendError) {
        throw state.sendError;
      }
      return { result: { result: true }, transaction: { txID: txId } };
    };
    client.trx.sign = async (transaction) => ({
      ...transaction,
      signature: ['test-signature'],
    });
    client.trx.sendRawTransaction = async () => ({ result: true, txid: txId });
  }
  t.mock.method(globalThis, 'fetch', async (url) => {
    switch (new URL(url).pathname) {
      case '/wallet/triggerconstantcontract':
        state.simulations++;
        if (state.simulationError) {
          throw state.simulationError;
        }
        return Response.json(state.response);
      case '/wallet/gettransactioninfobyid':
        return Response.json(state.receipt);
      case '/wallet/triggersmartcontract':
        return Response.json({
          result: { result: true },
          transaction: { txID: txId },
        });
      case '/wallet/broadcasttransaction':
        return Response.json({ result: true, txid: txId });
      default:
        assert.fail(`Unexpected request: ${url}`);
    }
  });
  const contract = await runtime.ethers.getContractAt('RevertFixture', address);
  return { state, runtime, contract };
}

test('low address arguments never turn native reverts into successful values', async (t) => {
  for (const value of [3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    await t.test(`address ${value}`, async (t) => {
      const { contract } = await fixture(t);
      const candidate = toBeHex(value, 20);
      for (const invoke of [
        () => contract.check(candidate),
        () => contract.calculate(candidate),
        () => contract.check.estimateGas(candidate),
        () => contract.check.staticCall(candidate),
        () => contract.pay.staticCall(candidate),
        () =>
          contract.check(TronWeb.address.fromHex('41' + candidate.slice(2))),
      ]) {
        await assert.rejects(invoke(), (error) => error.data === '0x');
      }
    });
  }
});

test('successful zero results remain distinct from explicit native failure', async (t) => {
  const { state, contract, runtime } = await fixture(t);
  state.response = {
    result: { result: true },
    constant_result: ['0'.repeat(64)],
  };
  assert.equal(await contract.check(toBeHex(4, 20)), false);
  assert.equal(await contract.calculate(toBeHex(4, 20)), 0n);
  assert.equal(await contract.pay.staticCall(toBeHex(4, 20)), ZeroAddress);
  state.response.result = { result: false };
  await assert.rejects(
    contract.check(toBeHex(4, 20)),
    (error) => error.data === '0x' + '0'.repeat(64),
  );
  await assert.rejects(
    runtime.ethers.provider.call({
      to: address,
      data: iface.encodeFunctionData('check', [ZeroAddress]),
    }),
    (error) => error.data === '0x' + '0'.repeat(64),
  );
});

test('unrelated bytecode selectors cannot supply missing revert bytes', async (t) => {
  const { state, contract } = await fixture(t);
  for (const bytecode of ['60006000fd', '60006000fd63d6bda27563b06ebf3d']) {
    state.bytecode = bytecode;
    await assert.rejects(
      contract.check(ZeroAddress),
      (error) => error.data === '0x',
    );
    await assert.rejects(
      contract.predict(ZeroAddress),
      (error) => error.data === '0x',
    );
  }
  assert.equal(state.codeReads, 0);
});

test('real custom, standard, panic and unknown revert bytes are preserved', async (t) => {
  const { state, contract } = await fixture(t);
  const cases = [
    [iface.encodeErrorResult('Deliberate', [42n]), 'Deliberate', [42n]],
    [
      '0x08c379a0' +
        AbiCoder.defaultAbiCoder()
          .encode(['string'], ['EXPECTED_REVERT'])
          .slice(2),
      'Error',
      ['EXPECTED_REVERT'],
    ],
    [
      '0x4e487b71' +
        AbiCoder.defaultAbiCoder().encode(['uint256'], [0x11n]).slice(2),
      'Panic',
      [0x11],
    ],
    ['0x12345678', undefined, undefined],
  ];
  for (const [data, name, args] of cases) {
    state.response = revertResponse(data);
    for (const invoke of [
      () => contract.check(toBeHex(4, 20)),
      () => contract.check.staticCall(ZeroAddress),
    ]) {
      await assert.rejects(invoke(), (error) => {
        assert.equal(error.data, data);
        assert.equal(error.code, 'CALL_EXCEPTION');
        assert.equal(error.revert?.name, name);
        if (args) {
          assert.deepEqual([...error.revert.args], args);
        }
        return true;
      });
    }
  }
  assert.equal(state.codeReads, 0);
});

test('failed receipts keep empty data when simulation succeeds or also reverts', async (t) => {
  const { state, contract, runtime } = await fixture(t);
  const impersonated = await runtime.ethers.getSigner('0x' + '3'.repeat(40));
  for (const response of [
    revertResponse(),
    {
      result: { result: true },
      constant_result: [
        iface.encodeFunctionResult('write', [ZeroAddress]).slice(2),
      ],
    },
  ]) {
    state.response = response;
    for (const invoke of [
      () => contract.write(),
      () => contract.writeTuple({ value: 1n }),
      () => contract.connect(impersonated).write(),
    ]) {
      await assert.rejects(invoke(), (error) => {
        assert.equal(error.data, '0x');
        assert.equal(error.txHash, '0x' + txId);
        assert.equal(error.receipt.status, 0);
        return true;
      });
      assert.equal(
        (await runtime.ethers.provider.getTransactionReceipt('0x' + txId))
          .status,
        0,
      );
    }
  }
  assert.equal(state.codeReads, 0);
});

test('receipt data takes precedence and actual replay bytes remain available', async (t) => {
  const { state, contract } = await fixture(t);
  const actual = iface.encodeErrorResult('Deliberate', [42n]);
  state.receipt.contractResult = [actual.slice(2)];
  state.response = revertResponse(iface.encodeErrorResult('FailedCall'));
  await assert.rejects(contract.write(), (error) => error.data === actual);
  assert.equal(state.simulations, 0);
  state.receipt.contractResult = [''];
  state.response = revertResponse(actual);
  await assert.rejects(
    contract.write(),
    (error) => error.data === actual && error.receipt.status === 0,
  );
  assert.equal(state.codeReads, 0);
});

test('failed sends retain the original error when replay has no revert bytes', async (t) => {
  const { state, contract } = await fixture(t);
  const original = new Error('OUT_OF_ENERGY');
  state.sendError = original;
  for (const response of [
    revertResponse(),
    {
      result: { result: true },
      constant_result: [
        iface.encodeFunctionResult('write', [ZeroAddress]).slice(2),
      ],
    },
  ]) {
    state.response = response;
    await assert.rejects(contract.write(), (error) => error === original);
  }
  state.simulationError = new Error('RPC unavailable during diagnostic replay');
  await assert.rejects(contract.write(), (error) => error === original);
  state.simulationError = undefined;
  state.response = revertResponse(iface.encodeErrorResult('Deliberate', [42n]));
  await assert.rejects(
    contract.write(),
    (error) =>
      error.data === '0x' + state.response.constant_result[0] &&
      error.cause === original,
  );
  assert.equal(state.codeReads, 0);
});

test('a send error with actual revert bytes is not replaced by replay', async (t) => {
  const { state, contract } = await fixture(t);
  const original = Object.assign(new Error('REVERT'), {
    data: iface.encodeErrorResult('Deliberate', [42n]),
  });
  state.sendError = original;
  await assert.rejects(contract.write(), (error) => error === original);
  assert.equal(state.simulations, 0);
});
