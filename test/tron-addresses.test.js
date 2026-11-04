import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { ethers as standardEthers } from 'ethers';
import { TronWeb } from 'tronweb';
import core from '../vendor/hardhat-tron/index.js';

const factoryAddress = '0x' + '1'.repeat(40);
const recipient = '0x' + '2'.repeat(40);
const childAddress = '0x' + '3'.repeat(40);
const tokenAddress = '0x' + '4'.repeat(40);
const predictedAddress = '0x' + '5'.repeat(40);
const iface = new standardEthers.Interface([
  'function owner() view returns (address)',
  'function simulate() payable returns (address)',
  'function createChild()',
  'function transfer(address recipient, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function forward(address[] recipients, (address recipient, address[] recipients) payload)',
]);
const tronHex = (address) => TronWeb.address.toHex(address).toLowerCase();

async function fixture(t, { caller = factoryAddress, rejected = false } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-addresses-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = resolve(root, 'artifacts/contracts/AddressFixture.sol');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, 'AddressFixture.json'),
    JSON.stringify({
      contractName: 'AddressFixture',
      abi: JSON.parse(iface.formatJson()).map((entry) => ({
        ...entry,
        stateMutability: entry.stateMutability ?? 'nonpayable',
      })),
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
  const [signer] = await runtime.ethers.getSigners();
  const operations = [];
  const broadcasts = [];
  let constantReverts = false;
  const txId = '6'.repeat(64);
  const receipt = {
    id: txId,
    blockNumber: 1,
    contract_address: tronHex(predictedAddress),
    receipt: { result: 'SUCCESS' },
    internal_transactions: [
      {
        note: '637265617465',
        caller_address: tronHex(caller),
        transferTo_address: tronHex(childAddress),
        rejected,
      },
    ],
  };
  for (const client of new Set([
    runtime.tre.makeTronWeb().tronWeb,
    signer.tronWeb,
  ])) {
    client.transactionBuilder.triggerSmartContract = async (
      address,
      selector,
      options,
    ) => {
      const fragment = iface.getFunction(selector);
      const parameters = iface.decodeFunctionData(
        fragment,
        fragment.selector + options.rawParameter.replace(/^0x/, ''),
      );
      operations.push({ address, selector, parameters });
      return { result: { result: true }, transaction: { txID: txId } };
    };
    client.transactionBuilder.createSmartContract = async () => {
      operations.push({ deploy: true });
      return { txID: txId, contract_address: tronHex(predictedAddress) };
    };
    client.trx.sign = async (transaction) => ({
      ...transaction,
      signature: ['test-signature'],
    });
    client.trx.sendRawTransaction = async (transaction) => {
      broadcasts.push(transaction);
      return { result: true, txid: txId };
    };
    client.trx.getContract = async (address) => {
      operations.push({ codeAddress: address });
      return { bytecode: '00' };
    };
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    const endpoint = new URL(url).pathname;
    operations.push({ endpoint, body });
    switch (endpoint) {
      case '/wallet/triggerconstantcontract':
        if (constantReverts) {
          return Response.json({
            result: { result: false, code: 'CONTRACT_EXE_ERROR' },
            constant_result: [],
          });
        }
        return Response.json({
          result: { result: true },
          constant_result: [
            iface.encodeFunctionResult('owner', [recipient]).slice(2),
          ],
        });
      case '/wallet/gettransactioninfobyid':
        return Response.json(receipt);
      case '/wallet/triggersmartcontract':
      case '/wallet/createtransaction':
        return Response.json({
          txID: txId,
          result: { result: true },
          transaction: { txID: txId },
        });
      case '/wallet/broadcasttransaction':
        broadcasts.push(body);
        return Response.json({ result: true, txid: txId });
      case '/wallet/getaccount':
        return Response.json({ balance: 7 });
      case '/jsonrpc':
        assert.equal(body.method, 'eth_getStorageAt');
        return Response.json({ result: '0x01' });
      default:
        assert.fail(`Unexpected endpoint: ${endpoint}`);
    }
  });
  const factory = await runtime.ethers.getContractAt(
    'AddressFixture',
    factoryAddress,
  );
  const token = await runtime.ethers.getContractAt(
    'AddressFixture',
    tokenAddress,
  );
  return {
    runtime,
    signer,
    factory,
    token,
    operations,
    broadcasts,
    rejectConstantCalls: () => {
      constantReverts = true;
    },
  };
}

test('ordinary address results cannot redirect later transactions', async (t) => {
  for (const [name, encode] of [
    ['EVM hex', () => recipient],
    ['base58', () => TronWeb.address.fromHex(tronHex(recipient))],
    ['TRON hex', () => tronHex(recipient)],
    ['contract target', () => ({ target: recipient })],
    ['signer address', () => ({ address: recipient })],
    ['typed address', () => standardEthers.Typed.address(recipient)],
  ]) {
    await t.test(name, async (t) => {
      const { factory, token, operations } = await fixture(t);
      assert.equal(await factory.owner(), recipient);
      await (await factory.createChild()).wait();
      for (const method of ['transfer', 'approve']) {
        await (await token[method](encode(), 7n)).wait();
        const sent = operations.findLast((entry) =>
          entry.selector?.startsWith(method),
        );
        assert.equal(sent.parameters[0], recipient);
      }
    });
  }
  await t.test(
    'unsupported address encodings cannot acquire a redirected recipient',
    async (t) => {
      const { factory, token, broadcasts } = await fixture(t);
      await factory.owner();
      await (await factory.createChild()).wait();
      const count = broadcasts.length;
      await assert.rejects(
        token.transfer('0x' + tronHex(recipient), 7n),
        /invalid address/,
      );
      assert.equal(broadcasts.length, count);
    },
  );
  for (const [name, options, observe] of [
    [
      'different caller control',
      { caller: tokenAddress },
      (factory) => factory.owner(),
    ],
    [
      'rejected internal CREATE',
      { rejected: true },
      (factory) => factory.owner(),
    ],
    ['gas estimation', {}, (factory) => factory.owner.estimateGas()],
    ['payable simulation', {}, (factory) => factory.simulate.staticCall()],
  ]) {
    await t.test(name, async (t) => {
      const { factory, token, operations } = await fixture(t, options);
      await observe(factory);
      await (await factory.createChild()).wait();
      await (await token.transfer(recipient, 7n)).wait();
      const sent = operations.findLast((entry) =>
        entry.selector?.startsWith('transfer'),
      );
      assert.equal(sent.parameters[0], recipient);
    });
  }
});

test('address arrays, tuples, targets and provider reads preserve address identity', async (t) => {
  const { runtime, signer, factory, token, operations } = await fixture(t);
  await factory.owner();
  await (await factory.createChild()).wait();
  await (
    await token.forward([recipient], { recipient, recipients: [recipient] })
  ).wait();
  const forwarded = operations.findLast(
    (entry) => entry.endpoint === '/wallet/triggersmartcontract',
  );
  const decoded = iface.decodeFunctionData(
    'forward',
    '0x' + forwarded.body.data,
  );
  assert.equal(decoded[0][0], recipient);
  assert.equal(decoded[1][0], recipient);
  assert.equal(decoded[1][1][0], recipient);

  await (
    await signer.sendTransaction({ to: recipient, data: '0x12345678' })
  ).wait();
  const sent = operations.findLast(
    (entry) => entry.endpoint === '/wallet/triggersmartcontract',
  );
  assert.equal(sent.body.contract_address.toLowerCase(), tronHex(recipient));
  await runtime.tre.sendTransferTx(signer.tronWeb, {
    fromBase58: signer.tronAddress,
    toBase58: TronWeb.address.fromHex(tronHex(recipient)),
    value: 7n,
  });
  const transferred = operations.findLast(
    (entry) => entry.endpoint === '/wallet/createtransaction',
  );
  assert.equal(transferred.body.to_address.toLowerCase(), tronHex(recipient));

  const provider = runtime.ethers.provider;
  assert.equal(await provider.getCode(recipient), '0x00');
  assert.equal(tronHex(operations.at(-1).codeAddress), tronHex(recipient));
  assert.equal(await provider.getBalance(recipient), 7n);
  assert.equal(
    operations.at(-1).body.address.toLowerCase(),
    tronHex(recipient),
  );
  await provider.getStorage(recipient, 0);
  assert.equal(operations.at(-1).body.params[0], recipient);
  await provider.call({ to: recipient, from: recipient, data: '0x12345678' });
  assert.equal(
    operations.at(-1).body.contract_address.toLowerCase(),
    tronHex(recipient),
  );
  assert.equal(
    operations.at(-1).body.owner_address.toLowerCase(),
    tronHex(recipient),
  );
  const attached = await runtime.ethers.getContractAt(
    'AddressFixture',
    recipient,
  );
  assert.equal(await attached.owner(), recipient);
  assert.equal(
    operations.at(-1).body.contract_address.toLowerCase(),
    tronHex(recipient),
  );
});

test('explicit native address prediction keeps the prebuilt transaction', async (t) => {
  const { runtime, signer, factory, operations, broadcasts } = await fixture(t);
  await factory.owner();
  await (await factory.createChild()).wait();
  assert.equal(await signer.predictAddress('AddressFixture'), predictedAddress);
  const builds = operations.filter((entry) => entry.deploy).length;
  const deployed = await runtime.ethers.deployContract(
    'AddressFixture',
    [],
    signer,
  );
  assert.equal(await deployed.getAddress(), predictedAddress);
  assert.equal(operations.filter((entry) => entry.deploy).length, builds);
  assert.equal(broadcasts.at(-1).contract_address, tronHex(predictedAddress));
  const salt = '0x' + '7'.repeat(64);
  const hash = standardEthers.keccak256('0x00');
  const expected = standardEthers.getAddress(
    standardEthers.dataSlice(
      standardEthers.keccak256(
        standardEthers.concat(['0x41', factoryAddress, salt, hash]),
      ),
      12,
    ),
  );
  assert.equal(
    runtime.ethers.getCreate2Address(factoryAddress, salt, hash),
    expected,
  );
});

test('empty reverts query the original contract during error recovery', async (t) => {
  const { runtime, factory, operations, rejectConstantCalls } =
    await fixture(t);
  await factory.owner();
  await (await factory.createChild()).wait();
  const attached = await runtime.ethers.getContractAt(
    'AddressFixture',
    recipient,
  );
  rejectConstantCalls();
  await assert.rejects(attached.owner(), (error) => error.data === '0x');
  assert.equal(tronHex(operations.at(-1).codeAddress), tronHex(recipient));
});
