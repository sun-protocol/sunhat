import assert from 'node:assert/strict';
import { expect } from 'chai';
import { network } from 'hardhat';
import { describe, it, afterEach } from 'mocha';
import {
  toBase58Address,
  toEvmAddress,
  nativeContractAddress,
} from '@openzeppelin/tron-runtime';

describe('Hardhat 3 TRON plugin', function () {
  this.timeout(90000);
  const connections = [];
  afterEach(async () => {
    const failures = [];
    for (const connection of connections.splice(0)) {
      try {
        await connection.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) {
      throw new AggregateError(
        failures,
        'Failed to close TRON test connections',
      );
    }
  });
  it('uses connection ethers on native TVM and preserves EVM coexistence', async function () {
    const first = await network.create('tre');
    connections.push(first);
    const second = await network.create('tre');
    connections.push(second);
    const evm = await network.create('evm');
    connections.push(evm);
    assert.ok(first.tre && second.tre);
    assert.equal(evm.tre, undefined);
    const evmCounter = await evm.ethers.deployContract('Counter');
    await evmCounter.waitForDeployment();
    await (await evmCounter.increment()).wait();
    assert.equal(await evmCounter.number(), 1n);
    const evmSigners = await evm.ethers.getSigners();
    await expect(
      evmSigners[0].sendTransaction({ to: evmSigners[1].address, value: 7n }),
    ).to.changeEtherBalances(
      evm.ethers,
      [evmSigners[0], evmSigners[1]],
      [-7n, 7n],
    );
    assert.equal((await evm.ethers.provider.getNetwork()).chainId, 31337n);
    assert.notEqual(first.ethers.provider, second.ethers.provider);
    const counter = await first.ethers.deployContract('Counter');
    await counter.waitForDeployment();
    assert.equal(await counter.number(), 0n);
    const deployed = await counter.deploymentTransaction().wait();
    assert.equal(deployed.status, 1);
    assert.ok(deployed.nativeReceipt.energy_usage_total > 0);
    assert.equal(
      deployed.nativeTransactionId,
      deployed.nativeTransactionInfo.id,
    );
    assert.equal(
      nativeContractAddress(
        deployed.nativeTransactionId,
        first.tre.makeTronWeb().tronWeb.defaultAddress.hex,
      ),
      toEvmAddress(await counter.getAddress()),
    );
    const updated = await (await counter.increment()).wait();
    assert.equal(updated.status, 1);
    assert.equal(await counter.number(), 1n);
    await expect(counter.increment())
      .to.emit(counter, 'NumberChanged')
      .withArgs(1n, 2n);
    const metadata = await first.provider.request({
      method: 'hardhat_metadata',
    });
    const otherMetadata = await second.provider.request({
      method: 'hardhat_metadata',
    });
    assert.equal(metadata.instanceId, otherMetadata.instanceId);
    assert.ok(metadata.instanceId);
    if (process.env.TRE_OTHER_URL) {
      const other = await network.create('other');
      connections.push(other);
      assert.notEqual(
        (await other.provider.request({ method: 'hardhat_metadata' }))
          .instanceId,
        metadata.instanceId,
      );
      assert.notEqual(
        (await other.ethers.getSigners())[0].address,
        (await first.ethers.getSigners())[0].address,
      );
      const otherCounter = await other.ethers.deployContract('Counter');
      await otherCounter.waitForDeployment();
      await (await otherCounter.increment()).wait();
      assert.equal(await otherCounter.number(), 1n);
      assert.equal(await counter.number(), 2n);
      await assert.rejects(other.tre.helpers.takeSnapshot(), /tre_snapshot/);
      await (await counter.increment()).wait();
      assert.equal(await otherCounter.number(), 1n);
      await (await counter.setNumber(2n)).wait();
    }
    const readonly = await network.create('readonly');
    connections.push(readonly);
    assert.equal((await readonly.ethers.getSigners()).length, 0);
    assert.equal(
      (await readonly.provider.request({ method: 'hardhat_metadata' }))
        .instanceId,
      metadata.instanceId,
    );
    const readCounter = await readonly.ethers.getContractAt(
      'Counter',
      await counter.getAddress(),
    );
    assert.equal(await readCounter.number(), 2n);
    await assert.rejects(
      readonly.ethers.deployContract('Counter'),
      /configured local signing account/,
    );
    assert.ok(
      updated.logs.some((entry) => entry.eventName === 'NumberChanged'),
    );
    assert.equal(
      await second.ethers.provider.getTransactionReceipt(updated.hash),
      null,
    );
    const [signer] = await first.ethers.getSigners();
    const token = await first.ethers.deployContract('TokenFixture');
    await token.waitForDeployment();
    const recipient = '0x' + '2'.repeat(40);
    await expect(token.transfer(recipient, 3n)).to.changeTokenBalances(
      first.ethers,
      token,
      [signer, recipient],
      [-3n, 3n],
    );
    await expect(token.transfer(recipient, 999n)).to.be.revertedWithCustomError(
      token,
      'InsufficientBalance',
    );
    const transfer = await signer.sendTransaction({
      to: '0x' + '2'.repeat(40),
      value: 1n,
    });
    const receipt = await transfer.wait();
    await expect(
      signer.sendTransaction({ to: '0x' + '2'.repeat(40), value: 2n }),
    ).to.changeEtherBalance(first.ethers, '0x' + '2'.repeat(40), 2n);
    assert.equal(receipt.status, 1);
    assert.ok(receipt.blockNumber > 0);
    assert.equal(receipt.nativeTransactionInfo.id, transfer.hash.slice(2));
    if (process.env.SUNHAT_PATCHED_TRE === 'true') {
      const snapshot = await first.tre.helpers.takeSnapshot();
      const afterSnapshot = await counter.increment();
      await afterSnapshot.wait();
      assert.equal(await counter.number(), 3n);
      await snapshot.restore();
      assert.equal(await counter.number(), 2n);
      assert.equal(
        (await first.ethers.provider.getTransactionReceipt(afterSnapshot.hash))
          .status,
        1,
      );
      const nativeHistory = await first.tre
        .makeTronWeb()
        .tronWeb.trx.getUnconfirmedTransactionInfo(afterSnapshot.hash.slice(2));
      assert.equal(nativeHistory.id, afterSnapshot.hash.slice(2));
      const rawSnapshot = await first.provider.request({
        method: 'evm_snapshot',
      });
      const rawMutation = await counter.increment();
      await rawMutation.wait();
      assert.equal(
        await first.provider.request({
          method: 'evm_revert',
          params: [rawSnapshot],
        }),
        true,
      );
      assert.equal(await counter.number(), 2n);
      assert.equal(
        (await first.ethers.provider.getTransactionReceipt(rawMutation.hash))
          .status,
        1,
      );
      const before = await first.tre.helpers.time.latest();
      await first.provider.request({ method: 'evm_mine', params: [] });
      await first.tre.helpers.time.increase(5);
      assert.ok((await first.tre.helpers.time.latest()) >= before + 5);
      const address = await signer.getAddress();
      await first.tre.helpers.setBalance(address, 1000000000000n);
      await first.tre.helpers.setStorageAt(
        await counter.getAddress(),
        '0x' + '0'.repeat(64),
        '0x' + '0'.repeat(63) + '5',
      );
      assert.equal(await counter.number(), 5n);
      const recipient = '0x' + '3'.repeat(40);
      await first.tre.helpers.setCode(recipient, '0x60006000f3');
      assert.equal(
        await first.ethers.provider.getCode(recipient),
        '0x60006000f3',
      );
      await first.tre.helpers.setBalance(recipient, 1000000n);
      await first.tre.helpers.impersonateAccount(recipient);
      const impersonated = await first.ethers.getSigner(recipient);
      const impersonatedReceipt = await (
        await impersonated.sendTransaction({ to: address, value: 1n })
      ).wait();
      assert.equal(impersonatedReceipt.status, 1);
      assert.ok(impersonatedReceipt.nativeTransactionInfo.blockNumber > 0);
      await first.tre.helpers.stopImpersonatingAccount(recipient);
    } else {
      await assert.rejects(first.tre.helpers.takeSnapshot(), /tre_snapshot/);
      await assert.rejects(first.tre.helpers.time.increase(5), /patched/);
    }
    assert.equal(
      toBase58Address(await counter.getAddress()),
      toBase58Address(deployed.nativeTransactionInfo.contract_address),
    );
    await first.close();
    connections.splice(connections.indexOf(first), 1);
    assert.equal((await second.ethers.provider.getBlockNumber()) > 0, true);
    console.log(
      `TRON_PLUGIN_RESULT ${JSON.stringify({ address: await counter.getAddress(), nativeReceipt: updated.nativeReceipt, patched: process.env.SUNHAT_PATCHED_TRE === 'true' })}`,
    );
  });
});
