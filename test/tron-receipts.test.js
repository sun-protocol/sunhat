import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { expect } from 'chai';
import { Interface } from 'ethers';
import core from '../vendor/hardhat-tron/index.js';

const tokenAddress = '0x' + '3'.repeat(40);
const recipient = '0x' + '2'.repeat(40);
const iface = new Interface([
  'function transfer(address to, uint256 value) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
core.registerMatchers();

async function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-receipts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = resolve(root, 'artifacts/contracts/Token.sol');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, 'Token.json'),
    JSON.stringify({
      abi: JSON.parse(iface.formatJson()).map((entry) =>
        entry.type === 'function'
          ? { ...entry, stateMutability: 'nonpayable' }
          : entry,
      ),
      bytecode: '0x6000',
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
  const [signer] = await runtime.ethers.getSigners();
  const impersonated = await runtime.ethers.getSigner(recipient);
  let sequence = 0;
  const state = { polls: [], failed: false };
  const kinds = new Map();
  const next = (execution = true) => {
    const id = (++sequence).toString(16).padStart(64, '0');
    kinds.set(id, execution);
    return id;
  };
  const event = iface.encodeEventLog('Transfer', [
    signer.address,
    recipient,
    7n,
  ]);
  t.mock.method(runtime.tre, 'waitForReceipt', async (_client, id, options) => {
    state.polls.push({ id, options });
    return {
      id,
      blockNumber: 1,
      fee: 13,
      ...(kinds.get(id) === false
        ? { result: state.failed ? 'FAILED' : undefined }
        : {
            receipt: {
              result: state.failed ? 'REVERT' : 'SUCCESS',
              energy_usage_total: 11,
            },
            log: [
              {
                address: tokenAddress.slice(2),
                topics: event.topics.map((value) => value.slice(2)),
                data: event.data.slice(2),
              },
            ],
          }),
    };
  });
  for (const client of [signer.tronWeb, runtime.tre.makeTronWeb().tronWeb]) {
    t.mock.method(client.trx, 'sign', async (tx) => ({
      ...tx,
      signature: ['fixture-signature'],
    }));
    t.mock.method(client.trx, 'sendTransaction', async () => ({
      result: true,
      txid: next(false),
    }));
    t.mock.method(client.trx, 'sendRawTransaction', async (tx) => ({
      result: true,
      txid: tx.txID,
    }));
    t.mock.method(
      client.transactionBuilder,
      'triggerSmartContract',
      async () => ({ result: { result: true }, transaction: { txID: next() } }),
    );
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    switch (new URL(url).pathname) {
      case '/wallet/triggersmartcontract':
        return Response.json({
          result: { result: true },
          transaction: { txID: next() },
        });
      case '/wallet/createtransaction':
        return Response.json({ txID: next(false) });
      case '/wallet/gettransactionbyid':
        return Response.json({
          raw_data: {
            contract: [
              {
                type:
                  kinds.get(JSON.parse(options.body).value) === false
                    ? 'TransferContract'
                    : 'TriggerSmartContract',
              },
            ],
          },
        });
      case '/wallet/broadcasttransaction':
        return Response.json({
          result: true,
          txid: JSON.parse(options.body).txID,
        });
      default:
        throw new Error(`Unexpected request: ${url}`);
    }
  });
  const token = await runtime.ethers.getContractAt('Token', tokenAddress);
  return { runtime, signer, impersonated, token, state };
}

test('facade, raw and impersonated calls share logs, receipt identity and balance assertions', async (t) => {
  const { runtime, signer, impersonated, token } = await fixture(t);
  const data = iface.encodeFunctionData('transfer', [recipient, 7n]);
  for (const send of [
    () => token.transfer(recipient, 7n),
    () => signer.sendTransaction({ to: tokenAddress, data }),
    () => impersonated.sendTransaction({ to: tokenAddress, data }),
  ]) {
    const response = await send();
    const receipt = await response.wait();
    assert.equal(receipt.status, 1);
    assert.equal(receipt.logs.length, 1);
    assert.equal(receipt.gasUsed, 11n);
    assert.equal(receipt.feeSun, 13);
    assert.equal(iface.parseLog(receipt.logs[0]).args.value, 7n);
    assert.equal(
      await runtime.ethers.provider.getTransactionReceipt(response.hash),
      receipt,
    );
    assert.equal(
      await runtime.ethers.provider.waitForTransaction(response.hash),
      receipt,
    );
    await expect(response).to.changeTokenBalance(token, recipient, 7n);
  }
});

test('native transfers keep inclusion status while even empty calldata requires execution success', async (t) => {
  const { signer, impersonated, state } = await fixture(t);
  for (const sender of [signer, impersonated]) {
    for (const failed of [false, true]) {
      state.failed = failed;
      const receipt = await (
        await sender.sendTransaction({ to: recipient, value: 7n })
      ).wait();
      assert.equal(receipt.status, failed ? 0 : 1);
      assert.equal(state.polls.at(-1).options.executionReceipt, false);
      if (failed) {
        await assert.rejects(
          sender.sendTransaction({ to: tokenAddress, data: '0x' }),
          (error) =>
            error.receipt.status === 0 && error.receipt.logs.length === 1,
        );
      } else {
        const call = await sender.sendTransaction({
          to: tokenAddress,
          data: '0x',
        });
        assert.equal((await call.wait()).status, 1);
      }
      assert.equal(state.polls.at(-1).options.executionReceipt, true);
    }
  }
});

for (const mode of ['raw', 'impersonated', 'provider']) {
  test(`${mode} receipt insertion evicts old entries without losing live response receipts`, async (t) => {
    const { runtime, signer, impersonated, state } = await fixture(t);
    const sender = mode === 'impersonated' ? impersonated : signer;
    const data = iface.encodeFunctionData('transfer', [recipient, 7n]);
    let first;
    let last;
    for (let index = 0; index < 2001; index++) {
      if (mode === 'provider') {
        const hash = '0x' + (index + 1).toString(16).padStart(64, '0');
        last = await runtime.ethers.provider.waitForTransaction(hash);
      } else {
        last = await sender.sendTransaction({ to: tokenAddress, data });
      }
      first ??= last;
    }
    assert.equal(
      await runtime.ethers.provider.getTransactionReceipt(first.hash),
      null,
    );
    assert.equal(
      (await runtime.ethers.provider.getTransactionReceipt(last.hash)).status,
      1,
    );
    if (first.wait) {
      assert.equal((await first.wait()).logs.length, 1);
    }
    const before = state.polls.length;
    const restored = await runtime.ethers.provider.waitForTransaction(
      first.hash,
    );
    assert.equal(state.polls.length, before + 1);
    assert.equal(restored.logs.length, 1);
    assert.equal(
      await runtime.ethers.provider.getTransactionReceipt(first.hash),
      restored,
    );
  });
}

for (const mode of ['raw', 'impersonated']) {
  test(`${mode} transfers recover inclusion status after receipt eviction`, async (t) => {
    const { runtime, signer, impersonated, state } = await fixture(t);
    const sender = mode === 'raw' ? signer : impersonated;
    const first = await sender.sendTransaction({ to: recipient, value: 7n });
    for (let index = 0; index < 2000; index++) {
      await sender.sendTransaction({ to: recipient, value: 1n });
    }
    assert.equal(
      await runtime.ethers.provider.getTransactionReceipt(first.hash),
      null,
    );
    const recovered = await runtime.ethers.provider.waitForTransaction(
      first.hash,
      1,
      1000,
    );
    assert.equal(recovered.status, 1);
    assert.equal(recovered.nativeReceipt, undefined);
    assert.equal(state.polls.at(-1).options.executionReceipt, false);
    state.failed = true;
    const failed = await sender.sendTransaction({ to: recipient, value: 1n });
    for (let index = 0; index < 2000; index++) {
      await sender.sendTransaction({ to: recipient, value: 1n });
    }
    assert.equal(
      await runtime.ethers.provider.getTransactionReceipt(failed.hash),
      null,
    );
    assert.equal(
      (await runtime.ethers.provider.waitForTransaction(failed.hash, 1, 1000))
        .status,
      0,
    );
  });
}
