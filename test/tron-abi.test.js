import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { Interface, Typed } from 'ethers';
import { TronWeb } from 'tronweb';
import { jsonParseBigSafe } from '@openzeppelin/tron-runtime';
import core from '../vendor/hardhat-tron/index.js';

const account = '0x' + '3'.repeat(40);
const declarations = [
  'function valueSeen() payable returns (uint256)',
  'function pick(uint256 first) payable returns (uint256)',
  'function pick(uint256 first, uint256 second) payable returns (uint256)',
  'function ambiguous(uint256 value) view returns (uint256)',
  'function ambiguous(address value) view returns (uint256)',
  'function grid((address owner, uint256 value)[][] rows) pure returns ((address owner, uint256 value)[][])',
  'function fixedRows((address owner, uint256 value)[1][] rows) pure returns ((address owner, uint256 value)[1][])',
  'function fixedOuter((address owner, uint256 value)[][2] rows) pure returns ((address owner, uint256 value)[][2])',
  'function structArg((uint256 value) row) view returns (uint256)',
  'function single() view returns ((uint256 value) row)',
  'function nested() view returns (((uint256 value) child) row)',
  'function multiple() view returns (uint256 count, (uint256 value) row)',
  'function scalar() view returns (uint256)',
  'function mutate() returns (uint256)',
  'function nothing()',
];

async function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-abi-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = resolve(root, 'artifacts/contracts/AbiFixture.sol');
  mkdirSync(directory, { recursive: true });
  const iface = new Interface(declarations);
  writeFileSync(
    resolve(directory, 'AbiFixture.json'),
    JSON.stringify({
      contractName: 'AbiFixture',
      abi: JSON.parse(iface.formatJson()),
      bytecode: '0x6000',
    }),
  );
  const runtime = core.createRuntime({
    config: {
      paths: { root, artifacts: resolve(root, 'artifacts') },
      tre: { fundSigners: false },
    },
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
  const state = { requests: [], result: () => [7n] };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).pathname, '/wallet/triggerconstantcontract');
    const body = jsonParseBigSafe(options.body);
    const fragment = iface.getFunction(body.function_selector);
    const args = iface.decodeFunctionData(
      fragment,
      fragment.selector + body.parameter,
    );
    state.requests.push({ body, raw: options.body, fragment, args });
    return Response.json({
      result: { result: true },
      constant_result: [
        iface
          .encodeFunctionResult(fragment, state.result(fragment, args, body))
          .slice(2),
      ],
    });
  });
  const contract = await runtime.ethers.getContractAt('AbiFixture', account);
  return { runtime, contract, iface, state };
}

test('payable simulations carry exact value for plain and Typed overrides', async (t) => {
  const { contract, state } = await fixture(t);
  state.result = (_fragment, _args, body) => [BigInt(body.call_value)];
  for (const value of [0n, 7n, 9007199254740993n, 9223372036854775807n]) {
    for (const overrides of [{ value }, Typed.overrides({ value })]) {
      assert.equal(await contract.valueSeen.staticCall(overrides), value);
      assert.match(
        state.requests.at(-1).raw,
        new RegExp(`"call_value":${value}(?:,|})`),
      );
    }
  }
  const before = state.requests.length;
  for (const value of [-1n, 9223372036854775808n]) {
    await assert.rejects(contract.valueSeen.staticCall({ value }));
  }
  assert.equal(state.requests.length, before);
});

test('overload resolution follows ethers for options, Typed arguments and ambiguity', async (t) => {
  const { contract, iface, state } = await fixture(t);
  for (const args of [
    [1n, {}],
    [1n, { blockTag: 'latest' }],
    [1n, { value: 2n }],
    [1n, Typed.overrides({ value: 2n })],
    [1n, 2n],
    [1n, 2n, {}],
  ]) {
    let expected;
    try {
      expected = iface.getFunction('pick', args);
    } catch (error) {
      const before = state.requests.length;
      await assert.rejects(
        contract.pick.staticCall(...args),
        (actual) => actual.code === error.code,
      );
      assert.equal(state.requests.length, before);
      continue;
    }
    await contract.pick.staticCall(...args);
    assert.equal(state.requests.at(-1).fragment.format(), expected.format());
    assert.equal(
      contract.pick.getFragment(...args).format(),
      expected.format(),
    );
  }
  for (const argument of [1n, account]) {
    const before = state.requests.length;
    await assert.rejects(contract.ambiguous(argument), /ambiguous function/);
    assert.equal(state.requests.length, before);
  }
  await contract.ambiguous(Typed.uint256(1n));
  assert.equal(state.requests.at(-1).fragment.format(), 'ambiguous(uint256)');
  await contract.ambiguous(Typed.address(account));
  assert.equal(state.requests.at(-1).fragment.format(), 'ambiguous(address)');
  const before = state.requests.length;
  await assert.rejects(
    contract.ambiguous(Typed.bytes('0x')),
    /No matching overload/,
  );
  assert.equal(state.requests.length, before);
  await contract.structArg({ value: 9n });
  assert.equal(state.requests.at(-1).args[0].value, 9n);
  await contract.structArg({ value: 9n }, {});
  assert.equal(state.requests.at(-1).args[0].value, 9n);
  for (const overrides of [{}, { blockTag: 'latest' }, Typed.overrides({})]) {
    assert.equal(await contract.scalar(overrides), 7n);
  }
});

test('nested tuple arrays use standard signatures, calldata and Result decoding', async (t) => {
  const { contract, iface, state } = await fixture(t);
  state.result = (_fragment, args) => [args[0]];
  const row = {
    owner: TronWeb.address.fromHex('41' + account.slice(2)),
    value: 9n,
  };
  for (const [name, rows] of [
    ['grid', [[row], []]],
    ['fixedRows', [[row], [row]]],
    ['fixedOuter', [[row], []]],
  ]) {
    const expectedRows = rows.map((group) =>
      group.map((entry) => ({ ...entry, owner: account })),
    );
    const fragment = iface.getFunction(name);
    const expectedData = iface.encodeFunctionData(fragment, [expectedRows]);
    for (const method of [
      contract[name],
      contract[fragment.format('full')],
      contract[fragment.selector],
      contract.getFunction(fragment.format()),
    ]) {
      const returned = await method(rows);
      const expected = iface.decodeFunctionResult(
        fragment,
        iface.encodeFunctionResult(fragment, [expectedRows]),
      )[0];
      assert.deepEqual(returned.toArray(true), expected.toArray(true));
      assert.equal(typeof returned.getValue, 'function');
      assert.equal(returned[0][0].owner, account);
      assert.equal(returned[0][0].value, 9n);
      assert.deepEqual(
        (await method(returned)).toArray(true),
        expected.toArray(true),
      );
      assert.equal(
        fragment.selector + state.requests.at(-1).body.parameter,
        expectedData,
      );
      assert.equal(
        state.requests.at(-1).body.function_selector,
        fragment.format('sighash'),
      );
    }
  }
  const before = state.requests.length;
  await assert.rejects(
    contract.fixedRows([[row, row]]),
    /array is wrong length/,
  );
  assert.equal(state.requests.length, before);
});

test('decoded return shapes match ethers and deployment waiting keeps the facade', async (t) => {
  const { contract, iface, state } = await fixture(t);
  for (const [name, outputs] of [
    ['single', [[9n]]],
    ['nested', [[[9n]]]],
    ['multiple', [2n, [9n]]],
    ['scalar', [9n]],
    ['mutate', [9n]],
    ['nothing', []],
  ]) {
    state.result = () => outputs;
    const decoded = iface.decodeFunctionResult(
      name,
      iface.encodeFunctionResult(name, outputs),
    );
    const expected = decoded.length === 1 ? decoded[0] : decoded;
    const actual = await contract[name].staticCall();
    assert.deepEqual(
      actual?.toArray?.(true) ?? actual,
      expected?.toArray?.(true) ?? expected,
    );
    if (name === 'single') {
      assert.equal(actual.value, 9n);
    }
    if (name === 'nested') {
      assert.equal(actual.child.value, 9n);
    }
    if (name === 'multiple') {
      assert.equal(actual.count, 2n);
      assert.equal(actual.row.value, 9n);
    }
  }
  assert.equal(await contract.waitForDeployment(), contract);
  state.result = () => [9n];
  assert.equal(await (await contract.waitForDeployment()).scalar(), 9n);
  state.result = () => [[9n]];
  const row = await contract.single();
  state.result = (_fragment, args) => [args[0].value];
  assert.equal(await contract.structArg(row), 9n);
  assert.equal(row.value, 9n);
});

test('invalid return bytes and transport errors never trigger a second decoder request', async (t) => {
  const { runtime, contract } = await fixture(t);
  let nativeRequests = 0;
  let sdkRequests = 0;
  t.mock.method(
    runtime.tre.makeTronWeb().tronWeb.fullNode,
    'request',
    async () => {
      sdkRequests += 1;
      throw new Error('Unexpected SDK fallback');
    },
  );
  t.mock.method(globalThis, 'fetch', async () => {
    nativeRequests += 1;
    return Response.json({ result: { result: true }, constant_result: ['01'] });
  });
  await assert.rejects(contract.scalar(), (error) => error.code === 'BAD_DATA');
  assert.equal(nativeRequests, 1);
  const original = new Error('EXPECTED_TRANSPORT_FAILURE');
  t.mock.method(globalThis, 'fetch', async () => {
    throw original;
  });
  await assert.rejects(contract.scalar(), (error) => error === original);
  assert.equal(sdkRequests, 0);
});

test('low-level deployments encode named nested tuple parameters before protobuf conversion', async (t) => {
  const { runtime } = await fixture(t);
  const { tronWeb, address } = runtime.tre.makeTronWeb();
  tronWeb.trx.getCurrentRefBlockParams = async () => ({
    ref_block_bytes: '0001',
    ref_block_hash: '11'.repeat(8),
    timestamp: 1700000000000,
    expiration: 1700000060000,
  });
  for (const type of [
    'tuple',
    'tuple[]',
    'tuple[][]',
    'tuple[1][]',
    'tuple[][2]',
  ]) {
    const input = {
      name: 'rows',
      type,
      components: [
        { name: 'owner', type: 'address' },
        { name: 'value', type: 'uint256' },
      ],
    };
    const abi = [
      { type: 'constructor', stateMutability: 'nonpayable', inputs: [input] },
    ];
    abi.push({
      type: 'event',
      name: 'Created',
      anonymous: false,
      inputs: [{ name: 'owner', type: 'address', indexed: true }],
    });
    const iface = new Interface(abi);
    const row = { owner: account, value: 9n };
    const value =
      type === 'tuple' ? row : type === 'tuple[]' ? [row] : [[row], [row]];
    const nativeRow = {
      ...row,
      owner: TronWeb.address.fromHex('41' + account.slice(2)),
    };
    const nativeValue =
      type === 'tuple'
        ? nativeRow
        : type === 'tuple[]'
          ? [nativeRow]
          : [[nativeRow], [nativeRow]];
    const { signedTx } = await runtime.tre.prebuildDeploy(
      tronWeb,
      address,
      { abi, bytecode: '0x6000' },
      { parameters: [nativeValue] },
    );
    const created = signedTx.raw_data.contract[0].parameter.value.new_contract;
    assert.equal(
      created.bytecode,
      '6000' + iface.encodeDeploy([value]).slice(2),
    );
    assert.equal(
      created.abi.entrys[0].inputs[0].type,
      iface.deploy.inputs[0].format('sighash'),
    );
    assert.equal(created.abi.entrys[0].stateMutability, 'nonpayable');
    assert.equal(created.abi.entrys[1].inputs[0].indexed, true);
    assert.ok(signedTx.signature.length > 0);
    const returned = new Interface([
      `function read() view returns (${iface.deploy.inputs[0].format('full')})`,
    ]);
    const result = returned.decodeFunctionResult(
      'read',
      returned.encodeFunctionResult('read', [value]),
    )[0];
    const roundtrip = await runtime.tre.prebuildDeploy(
      tronWeb,
      address,
      { abi, bytecode: '0x6000' },
      { parameters: [result] },
    );
    assert.equal(
      roundtrip.signedTx.raw_data.contract[0].parameter.value.new_contract
        .bytecode,
      created.bytecode,
    );
  }
});
