import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expect } from 'chai';
import { Contract, Interface, Wallet } from 'ethers';
import { TronWeb } from 'tronweb';
import createMatchers from '../vendor/hardhat-tron/runtime/chai-matchers-tvm.js';

const signer = new Wallet('0x' + '1'.padStart(64, '0'));
const recipient = signer.address;
const sender = '0x' + '2'.repeat(40);
const tokenAddress = '0x' + '3'.repeat(40);
const base58 = TronWeb.address.fromHex(recipient);
const tronHex = TronWeb.address.toHex(recipient);
const tokenInterface = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const token = new Contract({ getAddress: async () => tokenAddress }, []);
const contexts = new WeakMap();
createMatchers({
  resolveContext: (subject) => contexts.get(subject),
}).register();

function transaction() {
  const event = tokenInterface.encodeEventLog('Transfer', [
    sender,
    recipient,
    100n,
  ]);
  const receipt = { logs: [{ address: tokenAddress, ...event }] };
  const response = {
    from: sender,
    to: recipient,
    valueSun: 100n,
    feeSun: 7n,
    wait: async () => receipt,
  };
  contexts.set(response, {});
  return response;
}

const matchers = [
  'changeEtherBalance',
  'changeEtherBalances',
  'changeTokenBalance',
  'changeTokenBalances',
];

async function check(name, response, account, expected, negated = false) {
  const assertion = negated ? expect(response).not : expect(response);
  const plural = name.endsWith('s');
  const args = [plural ? [account] : account, plural ? [expected] : expected];
  if (name.startsWith('changeToken')) {
    args.unshift(token);
  }
  await assertion[name](...args);
}

for (const name of matchers) {
  test(`${name} resolves account identity without accepting a false zero delta`, async (t) => {
    for (const [label, account] of [
      ['EVM hex', recipient],
      ['base58', base58],
      ['TRON hex', tronHex],
      ['prefixed TRON hex', '0x' + tronHex],
      ['address field', { address: recipient }],
      ['target field', { target: recipient }],
      ['tronAddress field', { tronAddress: base58 }],
      ['signer', signer],
      ['Addressable', { getAddress: async () => recipient }],
      ['native Addressable', { getAddress: async () => base58 }],
      [
        'Contract with Addressable target',
        new Contract({ getAddress: async () => recipient }, []),
      ],
      [
        'Addressable takes precedence',
        { address: sender, target: sender, getAddress: async () => recipient },
      ],
    ]) {
      await t.test(label, async () => {
        const response = transaction();
        await check(name, response, account, 100n);
        await assert.rejects(check(name, response, account, 0n), /changed by/);
        await check(name, response, account, 0n, true);
        await assert.rejects(
          check(name, response, account, 100n, true),
          /but (it|they) did/,
        );
      });
    }
  });

  test(`${name} resolves once and preserves resolution errors`, async () => {
    let calls = 0;
    const account = {
      getAddress: async () => {
        calls++;
        return recipient;
      },
    };
    await assert.rejects(check(name, transaction(), account, 0n), (error) => {
      assert.ok(error.message.includes(recipient.toLowerCase()));
      return true;
    });
    assert.equal(calls, 1);
    const original = new Error('EXPECTED_ADDRESS_RESOLUTION_FAILURE');
    await assert.rejects(
      check(
        name,
        transaction(),
        {
          address: recipient,
          getAddress: async () => {
            throw original;
          },
        },
        0n,
      ),
      (error) => error === original,
    );
    for (const invalid of [
      null,
      undefined,
      {},
      { target: {} },
      { getAddress: async () => 'invalid' },
      { getAddress: async () => ({ address: recipient }) },
    ]) {
      await assert.rejects(check(name, transaction(), invalid, 0n));
    }
    await check(
      name,
      transaction(),
      {
        getAddress: async () => '0x' + '0'.repeat(40),
      },
      0n,
    );
  });
}

test('native balance resolution also applies to internal transfers and fees', async () => {
  const response = transaction();
  response.to = tokenAddress;
  response.internalTransactions = [
    {
      caller_address: TronWeb.address.toHex(tokenAddress),
      transferTo_address: tronHex,
      callValueInfo: [{ callValue: 100 }],
    },
  ];
  await expect(response).to.changeEtherBalance(
    { getAddress: async () => recipient },
    100n,
  );
  await expect(response).to.changeEtherBalances(
    [{ getAddress: async () => sender }, { getAddress: async () => recipient }],
    [-107n, 100n],
    { includeFee: true },
  );
});

test('plural balance matchers retain mixed account order and predicate inputs', async () => {
  const accounts = [
    { getAddress: async () => recipient },
    TronWeb.address.fromHex(sender),
    signer,
    { getAddress: async () => '0x' + '0'.repeat(40) },
  ];
  for (const name of ['changeEtherBalances', 'changeTokenBalances']) {
    let calls = 0;
    const expected = (changes) => {
      calls++;
      assert.deepEqual(changes, [100n, -100n, 100n, 0n]);
      return true;
    };
    const args = [accounts, expected];
    if (name.startsWith('changeToken')) {
      args.unshift(token);
    }
    await expect(transaction())[name](...args);
    assert.equal(calls, 1);
  }
});

test('token identity resolution errors cannot become a zero balance change', async () => {
  const original = new Error('EXPECTED_TOKEN_RESOLUTION_FAILURE');
  for (const name of ['changeTokenBalance', 'changeTokenBalances']) {
    for (const invalid of [
      { target: {} },
      {
        getAddress: async () => {
          throw original;
        },
      },
    ]) {
      await assert.rejects(
        async () => {
          if (name.endsWith('s')) {
            await expect(transaction())[name](invalid, [recipient], [0n]);
          } else {
            await expect(transaction())[name](invalid, recipient, 0n);
          }
        },
        (error) =>
          invalid.getAddress
            ? error === original
            : error.code === 'INVALID_ARGUMENT',
      );
    }
  }
});
