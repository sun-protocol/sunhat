import assert from 'node:assert/strict';
import { expect } from 'chai';
import { network } from 'hardhat';
import { Contract } from 'ethers';
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
  it('honors native signers for factory deployment and contract attachment', async function () {
    const connection = await network.create('tre');
    connections.push(connection);
    const { ethers } = connection;
    const [first, second] = await ethers.getSigners();
    assert.ok(first && second);
    const seed = await ethers.deployContract('TokenFixture', [], second);
    await seed.waitForDeployment();
    const runner = seed.runner;
    for (const [name, createFactory, signer] of [
      ['default', () => ethers.getContractFactory('TokenFixture'), first],
      [
        'explicit',
        () => ethers.getContractFactory('TokenFixture', second),
        second,
      ],
      [
        'native runner',
        () => ethers.getContractFactory('TokenFixture', runner),
        second,
      ],
      [
        'connected native runner',
        async () =>
          (await ethers.getContractFactory('TokenFixture')).connect(runner),
        second,
      ],
      [
        'options',
        () => ethers.getContractFactory('TokenFixture', { signer: second }),
        second,
      ],
      [
        'connected',
        async () =>
          (await ethers.getContractFactory('TokenFixture')).connect(second),
        second,
      ],
    ]) {
      const owner = await signer.getAddress();
      const other = signer === first ? second : first;
      const recipient = await other.getAddress();
      const factory = await createFactory();
      const token = await factory.deploy();
      await token.waitForDeployment();
      assert.equal(
        await token.balanceOf(owner),
        100n,
        `${name}: wrong deployer`,
      );
      assert.equal(await token.balanceOf(recipient), 0n);
      const attached = await ethers.getContractAt(
        'TokenFixture',
        await token.getAddress(),
        name === 'default'
          ? undefined
          : name.endsWith('runner')
            ? runner
            : signer,
      );
      await (await attached.transfer(recipient, 3n)).wait();
      assert.equal(await token.balanceOf(owner), 97n);
      assert.equal(await token.balanceOf(recipient), 3n);
      await (await attached.connect(other).transfer(owner, 1n)).wait();
      await (
        await factory.attach(await token.getAddress()).transfer(recipient, 1n)
      ).wait();
      assert.equal(await token.balanceOf(owner), 97n);
      assert.equal(await token.balanceOf(recipient), 3n);
    }
    const factory = await ethers.getContractFactory('TokenFixture', second);
    for (const invalid of [
      null,
      undefined,
      new ethers.Wallet('3'.padStart(64, '0')),
    ]) {
      assert.throws(() => factory.connect(invalid), /native TRON signer/);
      assert.throws(() => seed.connect(invalid), /native TRON signer/);
    }
  });
  it('keeps ordinary recipients after internal CREATE and preserves explicit prediction', async function () {
    const connection = await network.create('tre');
    connections.push(connection);
    const { ethers } = connection;
    const [sender, recipient] = await ethers.getSigners();
    const owner = await recipient.getAddress();
    const factory = await ethers.deployContract('AddressFactoryFixture', [
      owner,
    ]);
    const token = await ethers.deployContract('TokenFixture');
    assert.equal(await factory.owner(), owner);
    const receipt = await (await factory.createChild()).wait();
    const child = receipt.logs.find(
      (log) => log.fragment?.name === 'ChildCreated',
    ).args[0];
    const creates = receipt.nativeTransactionInfo.internal_transactions;
    assert.ok(
      creates?.some(
        (entry) =>
          entry.note === '637265617465' &&
          !entry.rejected &&
          toEvmAddress(entry.caller_address) === toEvmAddress(factory.target) &&
          toEvmAddress(entry.transferTo_address) === toEvmAddress(child),
      ),
      'CREATE receipt must exercise the address-pairing trigger',
    );
    await expect(token.transfer(owner, 7n)).to.changeTokenBalance(
      token,
      owner,
      7n,
    );
    await (await token.approve(owner, 11n)).wait();
    assert.equal(await token.balanceOf(owner), 7n);
    assert.equal(await token.balanceOf(child), 0n);
    assert.equal(await token.allowance(sender.address, owner), 11n);
    assert.equal(await token.allowance(sender.address, child), 0n);
    const attached = await ethers.getContractAt('Counter', child);
    await (await attached.increment()).wait();
    assert.equal(await attached.number(), 1n);

    const predicted = await sender.predictAddress('Counter');
    const deployed = await ethers.deployContract('Counter', [], sender);
    assert.equal(await deployed.getAddress(), predicted);
    await (await deployed.increment()).wait();
    assert.equal(await deployed.number(), 1n);
    const counterFactory = await ethers.getContractFactory('Counter');
    const salt = ethers.id('explicit CREATE2 prediction');
    const deterministic = ethers.getCreate2Address(
      factory.target,
      salt,
      ethers.keccak256(counterFactory.bytecode),
    );
    const deterministicReceipt = await (
      await factory.createDeterministicChild(salt)
    ).wait();
    const actual = deterministicReceipt.logs.find(
      (log) => log.fragment?.name === 'ChildCreated',
    ).args[0];
    assert.equal(actual, deterministic);
    const deterministicChild = await ethers.getContractAt('Counter', actual);
    await (await deterministicChild.increment()).wait();
    assert.equal(await deterministicChild.number(), 1n);
  });
  it('preserves native execution failures and decodes only actual revert bytes', async function () {
    const connection = await network.create('tre');
    connections.push(connection);
    const { ethers } = connection;
    const contract = await ethers.deployContract('RevertFixture');
    const code = await ethers.provider.getCode(contract.target);
    assert.ok(code.includes('d6bda275') && code.includes('b06ebf3d'));
    assert.equal(await contract.check(ethers.ZeroAddress), false);
    for (const value of [3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const candidate = ethers.toBeHex(value, 20);
      for (const invoke of [
        () => contract.check(candidate),
        () => contract.check.staticCall(candidate),
        () => contract.check.estimateGas(candidate),
        () => contract.pay.staticCall(candidate),
      ]) {
        await assert.rejects(invoke(), (error) => error.data === '0x');
      }
    }
    await assert.rejects(
      contract.write(),
      (error) => error.data === undefined || error.data === '0x',
    );
    await expect(contract.failCustom())
      .to.be.revertedWithCustomError(contract, 'Deliberate')
      .withArgs(42n);
    await expect(contract.failCustom.staticCall())
      .to.be.revertedWithCustomError(contract, 'Deliberate')
      .withArgs(42n);
    await expect(contract.failReason()).to.be.revertedWith('EXPECTED_REVERT');
    await expect(contract.failPanic()).to.be.revertedWithPanic(0x01);
  });
  it('binds predicted deployments to exact constructor bytes and effective overrides', async function () {
    const connection = await network.create('tre');
    connections.push(connection);
    const { ethers } = connection;
    const [signer] = await ethers.getSigners();
    const first = ['a,S:b', 'c'];
    const second = ['a', 'b,S:c'];
    const predicted = await signer.predictAddress('PredictionFixture', first);
    const different = await ethers.deployContract(
      'PredictionFixture',
      second,
      signer,
    );
    assert.notEqual(await different.getAddress(), predicted);
    assert.equal(await different.first(), second[0]);
    assert.equal(await different.second(), second[1]);
    const matching = await ethers.deployContract(
      'PredictionFixture',
      first,
      signer,
    );
    assert.equal(await matching.getAddress(), predicted);
    assert.equal(await matching.first(), first[0]);
    assert.equal(await matching.second(), first[1]);

    const fundedPrediction = await signer.predictAddress('PredictionFixture', [
      ...first,
      ethers.Typed.overrides({ value: 7n, gasLimit: 1000000n }),
    ]);
    const otherValue = await ethers.deployContract(
      'PredictionFixture',
      [...first, { value: 8n, gasLimit: 1000000n }],
      signer,
    );
    assert.notEqual(await otherValue.getAddress(), fundedPrediction);
    assert.equal(await otherValue.initialValue(), 8n);
    const funded = await ethers.deployContract(
      'PredictionFixture',
      [...first, { value: '7', gasLimit: 1000000 }],
      signer,
    );
    assert.equal(await funded.getAddress(), fundedPrediction);
    assert.equal(await funded.initialValue(), 7n);

    const settings = { target: signer.address, amount: 1n, labels: first };
    const structPrediction = await signer.predictAddress(
      'PredictionStructFixture',
      [settings],
    );
    const changed = { ...settings, amount: 2n };
    const otherStruct = await ethers.deployContract(
      'PredictionStructFixture',
      [changed],
      signer,
    );
    assert.notEqual(await otherStruct.getAddress(), structPrediction);
    const expectedDigest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['tuple(address target,uint256 amount,string[] labels)'],
        [changed],
      ),
    );
    assert.equal(await otherStruct.digest(), expectedDigest);
    const structFactory = await ethers.getContractFactory(
      'PredictionStructFixture',
      signer,
    );
    const matchingStruct = await structFactory.deploy([
      signer.address,
      '1',
      first,
    ]);
    assert.equal(await matchingStruct.getAddress(), structPrediction);
    assert.notEqual(await matchingStruct.digest(), expectedDigest);
    const stored = await signer.tronWeb.trx.getContract(
      toBase58Address(matchingStruct.target),
    );
    const storedEntries = stored.abi.entrys.filter(
      (entry) =>
        entry.type.toLowerCase() === 'constructor' ||
        entry.name === 'hashSettings',
    );
    assert.deepEqual(
      storedEntries.map((entry) => entry.inputs[0].type),
      ['(address,uint256,string[])', '(address,uint256,string[])'],
    );
    assert.equal(
      await matchingStruct.hashSettings([signer.address, '1', first]),
      await matchingStruct.digest(),
    );
    const emptyPrediction = await signer.predictAddress('PredictionFixture', [
      ...second,
      {},
    ]);
    const emptyFactory = await ethers.getContractFactory(
      'PredictionFixture',
      signer,
    );
    const emptyOverrides = await emptyFactory.deploy(...second, {});
    assert.equal(await emptyOverrides.getAddress(), emptyPrediction);
  });
  it('resolves Addressable accounts in all native balance matchers', async function () {
    const connection = await network.create('tre');
    connections.push(connection);
    const { ethers } = connection;
    const [sender, recipient] = await ethers.getSigners();
    const address = await recipient.getAddress();
    const addressable = { getAddress: async () => address };
    const contract = new Contract(addressable, []);
    const token = await ethers.deployContract('TokenFixture');
    const nativeBefore = await ethers.provider.getBalance(address);
    const native = await sender.sendTransaction({ to: address, value: 100n });
    await native.wait();
    assert.equal(
      await ethers.provider.getBalance(address),
      nativeBefore + 100n,
    );
    const tokensBefore = await token.balanceOf(address);
    const transfer = await token.transfer(address, 100n);
    await transfer.wait();
    assert.equal(await token.balanceOf(address), tokensBefore + 100n);
    for (const account of [address, recipient, addressable, contract]) {
      await expect(native).to.changeEtherBalance(ethers, account, 100n);
      await expect(native).to.changeEtherBalances(
        ethers,
        [sender, account],
        [-100n, 100n],
      );
      await expect(transfer).to.changeTokenBalance(
        ethers,
        token,
        account,
        100n,
      );
      await expect(transfer).to.changeTokenBalances(
        ethers,
        token,
        [sender, account],
        [-100n, 100n],
      );
      for (const assertion of [
        () => expect(native).to.changeEtherBalance(ethers, account, 0n),
        () => expect(native).to.changeEtherBalances(ethers, [account], [0n]),
        () =>
          expect(transfer).to.changeTokenBalance(ethers, token, account, 0n),
        () =>
          expect(transfer).to.changeTokenBalances(
            ethers,
            token,
            [account],
            [0n],
          ),
      ]) {
        await assert.rejects(async () => {
          await assertion();
        }, /changed by/);
      }
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
      let fixtureRuns = 0;
      async function deployFixture() {
        fixtureRuns += 1;
        const fixtureCounter = await first.ethers.deployContract('Counter');
        await fixtureCounter.waitForDeployment();
        return fixtureCounter;
      }
      const fixtureCounter = await first.tre.helpers.loadFixture(deployFixture);
      await (await fixtureCounter.increment()).wait();
      const restoredFixture =
        await first.tre.helpers.loadFixture(deployFixture);
      assert.equal(restoredFixture, fixtureCounter);
      assert.equal(await restoredFixture.number(), 0n);
      assert.equal(fixtureRuns, 1);
      let laterFixtureRuns = 0;
      async function laterFixture() {
        laterFixtureRuns += 1;
        return deployFixture();
      }
      await first.tre.helpers.loadFixture(laterFixture);
      await first.tre.helpers.loadFixture(deployFixture);
      await first.tre.helpers.loadFixture(laterFixture);
      assert.equal(laterFixtureRuns, 2);
      const beforeSecondFixture = fixtureRuns;
      await second.tre.helpers.loadFixture(deployFixture);
      assert.equal(fixtureRuns, beforeSecondFixture + 1);
      const block = await first.tre.helpers.time.latestBlock();
      await first.tre.helpers.mineUpTo(block + 2);
      assert.ok((await first.tre.helpers.time.latestBlock()) >= block + 2);
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
