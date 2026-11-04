import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Interface } from 'ethers';
import {
  createFeePolicy,
  normalizeFeePolicy,
} from '../vendor/hardhat-tron/runtime/fees.js';
import core from '../vendor/hardhat-tron/index.js';

const client = {
  fullNode: { host: 'http://127.0.0.1:9090/jsonrpc', timeout: 1000 },
};

test('fee policy validates configuration and uses exact arithmetic without a guessed price', async (t) => {
  for (const input of [
    null,
    [],
    1,
    { feeLimit: null },
    { feeLimit: 0 },
    { feeLimit: Number.MAX_SAFE_INTEGER + 1 },
    { energyPrice: -1 },
    { energyPrice: '100' },
  ]) {
    assert.throws(() => normalizeFeePolicy(input), /tre.transaction/);
  }
  let response = { chainParameter: [{ key: 'getEnergyFee', value: 210 }] };
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(new URL(url).pathname, '/wallet/getchainparameters');
    requests++;
    return Response.json(response);
  });
  const policy = createFeePolicy();
  assert.equal(await policy.resolve(client), 1000000000);
  assert.equal(requests, 0);
  assert.equal(await policy.resolve(client, 100n), 21000);
  response.chainParameter[0].value = '420';
  assert.equal(await policy.resolve(client, '0x64'), 42000);
  await assert.rejects(policy.resolve(client, 9007199254740993n), /feeLimit/);
  await assert.rejects(policy.resolve(client, -1n), /gasLimit/);
  for (const raw of [
    null,
    {},
    [],
    { chainParameter: [] },
    { chainParameter: [{ key: 'getEnergyFee' }] },
    ...[0, -1, 1.5, true, '1.5'].map((value) => ({
      chainParameter: [{ key: 'getEnergyFee', value }],
    })),
    {
      chainParameter: [
        { key: 'getEnergyFee', value: 100 },
        { key: 'getEnergyFee', value: 200 },
      ],
    },
  ]) {
    response = raw;
    await assert.rejects(policy.resolve(client, 1n), /getEnergyFee/);
  }
  const original = new Error('EXPECTED_PRICE_FAILURE');
  t.mock.method(globalThis, 'fetch', async () => {
    throw original;
  });
  await assert.rejects(
    policy.resolve(client, 1n),
    (error) => error === original,
  );
  const explicit = createFeePolicy({ feeLimit: 5000000000, energyPrice: 280 });
  assert.equal(await explicit.resolve(client, 100n), 28000);
  assert.equal(await explicit.resolve(client), 5000000000);
});

async function fixture(t, transaction) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const iface = new Interface([
    'function ping()',
    'function rows((uint256 value)[] values)',
  ]);
  const runtime = core.createRuntime({
    artifacts: {
      readArtifact: async () => ({
        abi: JSON.parse(iface.formatJson()).map((entry) => ({
          stateMutability: 'nonpayable',
          ...entry,
        })),
        bytecode: '0x6000',
      }),
    },
    config: { paths: { root, artifacts: root }, tre: { transaction } },
    network: {
      name: 'tre',
      config: {
        tron: true,
        url: client.fullNode.host,
        accounts: ['1'.padStart(64, '0')],
      },
      provider: { request: async () => assert.fail('Unexpected RPC') },
    },
  });
  const [signer] = await runtime.ethers.getSigners();
  const txId = 'a'.repeat(64);
  const fees = [];
  for (const tw of new Set([
    signer.tronWeb,
    runtime.tre.makeTronWeb().tronWeb,
  ])) {
    tw.transactionBuilder.triggerSmartContract = async (
      _to,
      _selector,
      options,
    ) => {
      fees.push(options.feeLimit);
      return { result: { result: true }, transaction: { txID: txId } };
    };
    tw.trx.sign = async (value) => ({
      ...value,
      signature: ['test-signature'],
    });
    tw.trx.sendRawTransaction = async () => ({ result: true, txid: txId });
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/wallet/getchainparameters') {
      return Response.json({
        chainParameter: [{ key: 'getEnergyFee', value: 210 }],
      });
    }
    if (path === '/wallet/triggersmartcontract') {
      fees.push(JSON.parse(options.body).fee_limit);
      return Response.json({
        result: { result: true },
        transaction: { txID: txId },
      });
    }
    if (path === '/wallet/broadcasttransaction') {
      return Response.json({ result: true, txid: txId });
    }
    assert.equal(path, '/wallet/gettransactioninfobyid');
    return Response.json({
      id: txId,
      blockNumber: 1,
      receipt: { result: 'SUCCESS' },
    });
  });
  const recipient = '0x' + '3'.repeat(40);
  const contract = await runtime.ethers.getContractAt('Fixture', recipient);
  const impersonated = await runtime.ethers.getSigner('0x' + '4'.repeat(40));
  return { runtime, signer, contract, impersonated, recipient, fees };
}

test('ordinary, tuple, raw and impersonated writes share the connection fee policy', async (t) => {
  const { runtime, signer, contract, impersonated, recipient, fees } =
    await fixture(t, {
      feeLimit: 2000000,
    });
  await contract.ping();
  assert.equal(fees.pop(), 2000000);
  for (const send of [
    () => contract.ping({ gasLimit: 100n }),
    () => contract.rows([{ value: 1n }], { gasLimit: 100n }),
    () =>
      signer.sendTransaction({
        to: recipient,
        data: '0x12345678',
        gasLimit: 100n,
      }),
    () => contract.connect(impersonated).ping({ gasLimit: 100n }),
    () =>
      impersonated.sendTransaction({
        to: recipient,
        data: '0x12345678',
        gasLimit: 100n,
      }),
  ]) {
    await send();
    assert.equal(fees.pop(), 21000);
  }
  await assert.rejects(contract.ping({ gasLimit: 100000n }), /feeLimit/);
  assert.equal(fees.length, 0);
  for (const actor of [signer, impersonated]) {
    await assert.rejects(
      actor.sendTransaction({ to: recipient, value: 1n, gasLimit: 1n }),
      /plain TRX transfers/,
    );
  }
  await assert.rejects(
    runtime.tre.sendCallTx(signer.tronWeb, {
      fromBase58: signer.tronAddress,
      toBase58: recipient,
      data: '0x',
      feeLimit: 2000001,
    }),
    /feeLimit/,
  );
});

test('prebuilt submissions cannot exceed the receiving connection budget', async (t) => {
  const { runtime, signer } = await fixture(t, { feeLimit: 2000000 });
  let broadcasts = 0;
  signer.tronWeb.trx.sendRawTransaction = async () => {
    broadcasts++;
    return { result: true };
  };
  for (const signed of [
    {},
    { raw_data: { fee_limit: 2000001 } },
    { raw_data: { fee_limit: 0 } },
  ]) {
    await assert.rejects(
      runtime.tre.submitPrebuilt(signer.tronWeb, signed),
      /fee.limit|feeLimit/,
    );
  }
  assert.equal(broadcasts, 0);
});
