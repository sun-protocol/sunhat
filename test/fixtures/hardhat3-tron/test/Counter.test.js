import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import {
  buildCall,
  buildCreate,
  jsonParseBigSafe,
  nativeContractAddress,
  nativeTxIdFromSignedBytes,
  toBase58Address,
  toEvmAddress,
  toTronHexAddress,
} from '@openzeppelin/tron-runtime';
import { Interface } from 'ethers';
import hre from 'hardhat';
import { describe, it } from 'mocha';
import { TronWeb } from 'tronweb';

const host = process.env.TRE_URL;
const privateKey = process.env.TRE_PRIVATE_KEY;
assert.ok(host && privateKey, 'Run this probe with npm run test:hardhat3:tron');
const endpoint = new URL(host);
assert.equal(endpoint.hostname, '127.0.0.1');
const tronWeb = new TronWeb({ fullHost: host, privateKey });
const signer = { privateKey, feeLimit: 100_000_000 };

async function broadcast(built, expectedType) {
  assert.equal(
    nativeTxIdFromSignedBytes(built.signedNativeTransaction),
    built.nativeTransactionId,
  );
  const sent = await tronWeb.trx.sendRawTransaction(built.transaction);
  assert.equal(sent.result, true, JSON.stringify(sent));
  assert.equal(sent.txid, built.nativeTransactionId);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(
      new URL('/wallet/gettransactioninfobyid', host),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: sent.txid }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    assert.equal(response.ok, true, `Receipt HTTP ${response.status}`);
    const info = jsonParseBigSafe(await response.text());
    if (info.receipt) {
      const transaction = await tronWeb.trx.getTransaction(sent.txid);
      assert.equal(transaction.raw_data.contract[0].type, expectedType);
      assert.equal(transaction.ret[0].contractRet, 'SUCCESS');
      assert.equal(info.receipt.result, 'SUCCESS');
      assert.ok(BigInt(info.receipt.energy_usage_total) > 0n);
      assert.ok(
        BigInt(info.receipt.net_usage ?? 0) > 0n ||
          BigInt(info.receipt.net_fee ?? 0) > 0n,
        'Native bandwidth consumption or its sun fee must be reported',
      );
      return info;
    }
    await setTimeout(250);
  }
  assert.fail(`Native TRE receipt timed out for ${sent.txid}`);
}

describe('Hardhat 3 native TRON compatibility probe', function () {
  this.timeout(90_000);

  it('deploys TVM bytecode and verifies state, logs, native IDs and resource units', async function () {
    const artifact = await hre.artifacts.readArtifact('Counter');
    const buildId = await hre.artifacts.getBuildInfoId('Counter');
    assert.ok(buildId);
    const buildPath = await hre.artifacts.getBuildInfoPath(buildId);
    assert.ok(buildPath);
    const build = JSON.parse(await readFile(buildPath, 'utf8'));
    assert.equal(build.solcVersion, '0.8.26');
    assert.equal(build.solcLongVersion, '0.8.26+commit.733b4d28');
    const abi = new Interface(artifact.abi);
    const deployment = await buildCreate(
      tronWeb,
      { abi: artifact.abi, bytecode: artifact.bytecode, name: 'Counter' },
      signer,
    );
    const deployed = await broadcast(deployment, 'CreateSmartContract');
    const address = toBase58Address(deployed.contract_address);
    assert.equal(toTronHexAddress(address), deployed.contract_address);
    assert.equal(toBase58Address(toEvmAddress(address)), address);
    assert.equal(
      nativeContractAddress(
        deployment.nativeTransactionId,
        tronWeb.defaultAddress.hex,
      ),
      toEvmAddress(address),
    );

    const counter = await tronWeb.contract(artifact.abi, address);
    assert.equal(BigInt(await counter.number().call()), 0n);
    const mutation = await buildCall(
      tronWeb,
      { contractAddress: address, data: abi.encodeFunctionData('increment') },
      signer,
    );
    const updated = await broadcast(mutation, 'TriggerSmartContract');
    assert.equal(BigInt(await counter.number().call()), 1n);
    const event = updated.log
      .filter((log) => toEvmAddress(log.address) === toEvmAddress(address))
      .map((log) =>
        abi.parseLog({
          topics: log.topics.map((topic) => `0x${topic}`),
          // Native protobuf JSON omits empty data for an all-indexed event.
          data: `0x${log.data ?? ''}`,
        }),
      )
      .find((entry) => entry?.name === 'NumberChanged');
    assert.ok(event, 'The native receipt must contain NumberChanged');
    assert.deepEqual([...event.args], [0n, 1n]);
    console.log(
      `TRE_RESULT ${JSON.stringify({
        compilerLongVersion: build.solcLongVersion,
        address,
        deployment: { id: deployed.id, receipt: deployed.receipt },
        mutation: { id: updated.id, receipt: updated.receipt },
      })}`,
    );
  });
});
