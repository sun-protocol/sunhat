import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { Interface, Typed } from 'ethers';
import { TronWeb } from 'tronweb';
import core from '../vendor/hardhat-tron/index.js';

const recipient = '0x' + '3'.repeat(40);
const constructors = {
  Strings: 'constructor(string first, string second)',
  Nested: 'constructor(string[][] entries)',
  Struct: 'constructor((address target, uint256 amount) config) payable',
  Values:
    'constructor(uint256 amount, address recipient, bytes payload) payable',
  Empty: 'constructor() payable',
};

async function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-predictions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, constructor] of Object.entries(constructors)) {
    const directory = resolve(root, `artifacts/contracts/${name}.sol`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      resolve(directory, `${name}.json`),
      JSON.stringify({
        contractName: name,
        sourceName: `contracts/${name}.sol`,
        abi: JSON.parse(new Interface([constructor]).formatJson()),
        bytecode: '0x6000',
      }),
    );
  }
  const runtime = core.createRuntime({
    config: { paths: { root, artifacts: resolve(root, 'artifacts') }, tre: {} },
    network: {
      name: 'tre',
      config: {
        tron: true,
        url: 'http://127.0.0.1:9090/jsonrpc',
        accounts: [1, 2].map((key) => key.toString().padStart(64, '0')),
      },
      provider: { request: async () => '0x1' },
    },
  });
  const signers = await runtime.ethers.getSigners();
  const state = { builds: 0, broadcasts: [], beforeHeader: undefined };
  for (const client of new Set([
    runtime.tre.makeTronWeb().tronWeb,
    ...signers.map((signer) => signer.tronWeb),
  ])) {
    // Keep real ABI encoding, protobuf construction and local signing.
    client.trx.getCurrentRefBlockParams = async () => {
      state.builds++;
      state.beforeHeader?.();
      const timestamp = 1700000000000 + state.builds;
      return {
        ref_block_bytes: '0001',
        ref_block_hash: '11'.repeat(8),
        timestamp,
        expiration: timestamp + 60000,
      };
    };
    client.trx.sendRawTransaction = async (transaction) => {
      state.broadcasts.push(structuredClone(transaction));
      return { result: true, txid: transaction.txID };
    };
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).pathname, '/wallet/gettransactioninfobyid');
    const { value: txId } = JSON.parse(options.body);
    const transaction = state.broadcasts.find((entry) => entry.txID === txId);
    assert.ok(transaction, 'Only broadcast transactions may have a receipt');
    return Response.json({
      id: txId,
      blockNumber: 1,
      contract_address: transaction.contract_address,
      receipt: { result: 'SUCCESS' },
    });
  });
  return { runtime, signers, state };
}

function assertPayload(transaction, name, args) {
  assert.equal(
    transaction.raw_data.contract[0].parameter.value.new_contract.bytecode,
    '6000' + new Interface([constructors[name]]).encodeDeploy(args).slice(2),
  );
  assert.equal(transaction.signature.length, 1);
}

test('delimiter-bearing constructor arguments cannot reuse another signed deployment', async (t) => {
  for (const [name, first, second] of [
    ['Strings', ['a,S:b', 'c'], ['a', 'b,S:c']],
    ['Nested', [[['a,S:b', 'c']]], [[['a', 'b,S:c']]]],
  ]) {
    await t.test(name, async (t) => {
      const {
        runtime,
        signers: [signer],
        state,
      } = await fixture(t);
      const predicted = await signer.predictAddress(name, first);
      const other = await runtime.ethers.deployContract(name, second, signer);
      assert.equal(state.builds, 2);
      assert.notEqual(await other.getAddress(), predicted);
      assertPayload(state.broadcasts.at(-1), name, second);
      const matching = await runtime.ethers.deployContract(name, first, signer);
      assert.equal(await matching.getAddress(), predicted);
      assert.equal(state.builds, 2);
      assertPayload(state.broadcasts.at(-1), name, first);
      await runtime.ethers.deployContract(name, first, signer);
      assert.equal(state.builds, 3, 'A prediction is consumed once');
    });
  }
});

test('struct address-like fields do not hide the rest of the constructor', async (t) => {
  const {
    runtime,
    signers: [signer],
    state,
  } = await fixture(t);
  const first = [{ target: recipient, amount: 1n }];
  const second = [{ target: recipient, amount: 2n }];
  const predicted = await signer.predictAddress('Struct', first);
  const deployed = await runtime.ethers.deployContract(
    'Struct',
    second,
    signer,
  );
  assert.notEqual(await deployed.getAddress(), predicted);
  assert.equal(state.builds, 2);
  assertPayload(state.broadcasts.at(-1), 'Struct', second);
  const matching = await runtime.ethers.deployContract(
    'Struct',
    [[recipient, '1']],
    signer,
  );
  assert.equal(await matching.getAddress(), predicted);
  assert.equal(state.builds, 2);
});

test('ABI-equivalent BigInt, Typed, address and bytes representations match', async (t) => {
  const {
    runtime,
    signers: [signer],
    state,
  } = await fixture(t);
  const predicted = await signer.predictAddress('Values', [
    Typed.uint256(7n),
    { target: recipient },
    new Uint8Array([1, 2]),
  ]);
  const factory = await runtime.ethers.getContractFactory('Values', signer);
  const deployed = await factory.deploy(
    '7',
    TronWeb.address.fromHex('41' + recipient.slice(2)),
    '0x0102',
  );
  assert.equal(await deployed.getAddress(), predicted);
  assert.equal(state.builds, 1);
  assertPayload(state.broadcasts[0], 'Values', [7n, recipient, '0x0102']);
});

test('effective deployment overrides are part of the cache identity', async (t) => {
  for (const [label, first, second] of [
    ['value', { value: 7n, gasLimit: 100n }, { value: 8n, gasLimit: 100n }],
    ['fee limit', { value: 7n, gasLimit: 100n }, { value: 7n, gasLimit: 101n }],
  ]) {
    await t.test(label, async (t) => {
      const {
        runtime,
        signers: [signer],
        state,
      } = await fixture(t);
      const predicted = await signer.predictAddress('Empty', [first]);
      const deployed = await runtime.ethers.deployContract(
        'Empty',
        [second],
        signer,
      );
      assert.notEqual(await deployed.getAddress(), predicted);
      assert.equal(state.builds, 2);
      const transaction = state.broadcasts.at(-1);
      assert.equal(
        transaction.raw_data.fee_limit,
        Number(second.gasLimit) * 100,
      );
      assert.equal(
        transaction.raw_data.contract[0].parameter.value.new_contract
          .call_value,
        Number(second.value),
      );
      const matching = await runtime.ethers.deployContract(
        'Empty',
        [first],
        signer,
      );
      assert.equal(await matching.getAddress(), predicted);
      assert.equal(state.builds, 2);
    });
  }
});

test('Typed and equivalent effective overrides share the predicted transaction', async (t) => {
  const {
    runtime,
    signers: [signer],
    state,
  } = await fixture(t);
  const predicted = await signer.predictAddress('Empty', [
    Typed.overrides({ value: 7n, gasLimit: 20000000n }),
  ]);
  const deployed = await runtime.ethers.deployContract(
    'Empty',
    [{ value: '7', gasLimit: 30000000, nonce: 99 }],
    signer,
  );
  assert.equal(await deployed.getAddress(), predicted);
  assert.equal(state.builds, 1);
  assert.equal(state.broadcasts[0].raw_data.fee_limit, 1000000000);
});

test('signers and artifacts have separate prediction identities', async (t) => {
  const {
    runtime,
    signers: [first, second],
    state,
  } = await fixture(t);
  const predicted = await first.predictAddress('Strings', ['a', 'b']);
  const other = await runtime.ethers.deployContract(
    'Strings',
    ['a', 'b'],
    second,
  );
  assert.notEqual(await other.getAddress(), predicted);
  assert.equal(state.builds, 2);
  assert.equal(
    state.broadcasts[0].raw_data.contract[0].parameter.value.owner_address.toLowerCase(),
    second.tronWeb.defaultAddress.hex.toLowerCase(),
  );
  await runtime.ethers.deployContract('Nested', [[['a', 'b']]], first);
  assert.equal(state.builds, 3);
  const matching = await runtime.ethers.deployContract(
    'contracts/Strings.sol:Strings',
    ['a', 'b'],
    first,
  );
  assert.equal(await matching.getAddress(), predicted);
  assert.equal(state.builds, 3);
});

test('input mutation during prebuilding cannot relabel the signed transaction', async (t) => {
  const {
    runtime,
    signers: [signer],
    state,
  } = await fixture(t);
  const args = ['original', 'second'];
  state.beforeHeader = () => {
    args[0] = 'changed';
  };
  const predicted = await signer.predictAddress('Strings', args);
  state.beforeHeader = undefined;
  const deployed = await runtime.ethers.deployContract('Strings', args, signer);
  assert.notEqual(await deployed.getAddress(), predicted);
  assert.equal(state.builds, 2);
  assertPayload(state.broadcasts.at(-1), 'Strings', args);
  const matching = await runtime.ethers.deployContract(
    'Strings',
    ['original', 'second'],
    signer,
  );
  assert.equal(await matching.getAddress(), predicted);
  assert.equal(state.builds, 2);
});

test('invalid constructor arguments cannot consume a valid prediction', async (t) => {
  const {
    runtime,
    signers: [signer],
    state,
  } = await fixture(t);
  const predicted = await signer.predictAddress('Strings', ['a', 'b']);
  await assert.rejects(
    runtime.ethers.deployContract('Strings', ['a', 'b', 'extra'], signer),
  );
  await assert.rejects(
    signer.predictAddress('Values', [7n, 'invalid-address', '0x']),
  );
  assert.equal(state.builds, 1);
  assert.equal(state.broadcasts.length, 0);
  const matching = await runtime.ethers.deployContract(
    'Strings',
    ['a', 'b'],
    signer,
  );
  assert.equal(await matching.getAddress(), predicted);
});

test('empty constructor overrides remain equivalent to omitted overrides', async (t) => {
  for (const name of ['Empty', 'Strings']) {
    await t.test(name, async (t) => {
      const {
        runtime,
        signers: [signer],
        state,
      } = await fixture(t);
      const args = name === 'Empty' ? [] : ['a', 'b'];
      const factory = await runtime.ethers.getContractFactory(name, signer);
      for (const [before, after] of [
        [
          [...args, {}],
          [...args, Typed.overrides({})],
        ],
        [args, [...args, {}]],
        [
          [...args, Typed.overrides({})],
          [...args, Object.create(null)],
        ],
      ]) {
        const predicted = await signer.predictAddress(name, before);
        const builds = state.builds;
        const deployed = await factory.deploy(...after);
        assert.equal(await deployed.getAddress(), predicted);
        assert.equal(state.builds, builds);
        assertPayload(state.broadcasts.at(-1), name, args);
      }
    });
  }
});

test('non-enumerable effective overrides cannot match an empty deployment', async (t) => {
  for (const [name, value] of [
    ['value', 7n],
    ['gasLimit', 100n],
  ]) {
    await t.test(name, async (t) => {
      const {
        runtime,
        signers: [signer],
        state,
      } = await fixture(t);
      const defaults = await signer.predictAddress('Empty');
      const overrides = Object.defineProperty(Object.create(null), name, {
        value,
      });
      const different = await runtime.ethers.deployContract(
        'Empty',
        [overrides],
        signer,
      );
      assert.notEqual(await different.getAddress(), defaults);
      assert.equal(state.builds, 2);
      const transaction = state.broadcasts.at(-1);
      assert.equal(
        transaction.raw_data.fee_limit,
        name === 'gasLimit' ? 10000 : 1000000000,
      );
      assert.equal(
        transaction.raw_data.contract[0].parameter.value.new_contract
          .call_value ?? 0,
        name === 'value' ? 7 : 0,
      );
      const predicted = await signer.predictAddress('Empty', [overrides]);
      const matching = await runtime.ethers.deployContract(
        'Empty',
        [{ [name]: value }],
        signer,
      );
      assert.equal(await matching.getAddress(), predicted);
      assert.equal(state.builds, 3);
    });
  }
});
