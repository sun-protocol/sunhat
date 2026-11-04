import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { test } from 'node:test';
import { Interface } from 'ethers';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import core from '../vendor/hardhat-tron/index.js';
import plugin from '../dist/plugins/tron/index.js';
import { artifactsFor } from '../dist/plugins/tron/artifacts.js';
import solidityHooks from '../dist/plugins/tron/solidity.js';

function temporary(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-tron-artifacts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    resolve(root, 'package.json'),
    JSON.stringify({ name: 'artifact-fixture', private: true, type: 'module' }),
  );
  return root;
}

function writeArtifact(
  root,
  source,
  name = 'Sample',
  method = 'before',
  bytecode = '0x6000',
) {
  const artifact = {
    _format: 'hh3-artifact-1',
    sourceName: source,
    contractName: name,
    abi: JSON.parse(
      new Interface([
        `function ${method}() view returns (uint256)`,
      ]).formatJson(),
    ),
    bytecode,
    deployedBytecode: '0x',
    linkReferences: {},
    deployedLinkReferences: {},
    immutableReferences: {},
  };
  const filename = resolve(root, source, `${name}.json`);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, JSON.stringify(artifact));
  return artifact;
}

function runtime(root, artifacts) {
  return core.createRuntime({
    artifacts,
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
}

function nativeDeployments(t, connection, signers) {
  const broadcasts = [];
  let headers = 0;
  for (const tronWeb of new Set([
    connection.tre.makeTronWeb().tronWeb,
    ...signers.map((signer) => signer.tronWeb),
  ])) {
    tronWeb.trx.getCurrentRefBlockParams = async () => {
      headers += 1;
      return {
        ref_block_bytes: '0001',
        ref_block_hash: '11'.repeat(8),
        timestamp: 1700000000000 + headers,
        expiration: 1700000060000 + headers,
      };
    };
    tronWeb.trx.sendRawTransaction = async (transaction) => {
      broadcasts.push(transaction);
      return { result: true, txid: transaction.txID };
    };
  }
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const { value: txId } = JSON.parse(options.body);
    const transaction = broadcasts.find((entry) => entry.txID === txId);
    assert.ok(transaction);
    return Response.json({
      id: txId,
      blockNumber: 1,
      contract_address: transaction.contract_address,
      receipt: { result: 'SUCCESS' },
    });
  });
  return { broadcasts, builds: () => headers };
}

test('standalone lookup searches custom source roots, dependencies and fresh ambiguity', async (t) => {
  const root = temporary(t);
  const directory = resolve(root, 'artifacts');
  const connection = runtime(root);
  writeArtifact(directory, 'src/custom/Source.sol');
  writeArtifact(directory, 'generated/wrappers/Exposed.sol', 'Exposed');
  writeArtifact(directory, '@example/dependency/Dependency.sol', 'Dependency');
  writeArtifact(directory, 'build-info', 'Sample');
  writeFileSync(resolve(directory, 'Sample.json'), '{}');
  for (const name of ['Sample', 'Exposed', 'Dependency']) {
    assert.equal(
      (await connection.ethers.getContractFactory(name)).bytecode,
      '0x6000',
    );
  }
  writeArtifact(directory, '@example/dependency/Duplicate.sol');
  await assert.rejects(
    connection.ethers.getContractFactory('Sample'),
    /Multiple artifacts/,
  );
  for (const name of [
    'src/custom/Source.sol:Sample',
    '@example/dependency/Duplicate.sol:Sample',
  ]) {
    assert.equal(
      (await connection.ethers.getContractFactory(name)).bytecode,
      '0x6000',
    );
  }
  writeFileSync(
    resolve(directory, 'src/custom/Source.sol/Sample.json'),
    'null',
  );
  await assert.rejects(
    connection.ethers.getContractFactory('src/custom/Source.sol:Sample'),
    /Invalid contract artifact/,
  );
  writeFileSync(resolve(directory, 'src/custom/Source.sol/Sample.json'), '{');
  await assert.rejects(
    connection.ethers.getContractFactory('src/custom/Source.sol:Sample'),
    (error) =>
      error.cause instanceof SyntaxError &&
      error.message.includes('Source.sol'),
  );
});

test('factories retain their artifact while new reads and predictions see updated content', async (t) => {
  const root = temporary(t);
  const source = 'src/custom/Source.sol';
  writeArtifact(resolve(root, 'artifacts'), source);
  const hre = await createHardhatRuntimeEnvironment({}, {}, root);
  const connection = runtime(root, hre.artifacts);
  const [signer] = await connection.ethers.getSigners();
  const state = nativeDeployments(t, connection, [signer]);
  const factory = await connection.ethers.getContractFactory('Sample');
  const predicted = await signer.predictAddress('Sample');
  writeArtifact(
    resolve(root, 'artifacts'),
    source,
    'Sample',
    'after',
    '0x6001',
  );
  const updated = await connection.ethers.getContractFactory('Sample');
  assert.ok(updated.interface.getFunction('after'));
  assert.equal(updated.bytecode, '0x6001');
  const attached = factory.attach('0x' + '3'.repeat(40));
  const connected = factory.connect(signer);
  assert.equal(attached.then, undefined);
  assert.equal(connected.then, undefined);
  assert.ok(attached.interface.getFunction('before'));
  const fromOldFactory = await connected.deploy();
  assert.equal(await fromOldFactory.getAddress(), predicted);
  assert.equal(state.builds(), 1);
  assert.equal(
    state.broadcasts[0].raw_data.contract[0].parameter.value.new_contract
      .bytecode,
    '6000',
  );
  const fresh = await connection.ethers.deployContract(`${source}:Sample`);
  assert.notEqual(await fresh.getAddress(), predicted);
  assert.equal(
    state.broadcasts[1].raw_data.contract[0].parameter.value.new_contract
      .bytecode,
    '6001',
  );
  const nextPrediction = await signer.predictAddress('Sample');
  const next = await connection.ethers.deployContract(`${source}:Sample`);
  assert.equal(await next.getAddress(), nextPrediction);
});

test('public artifact caches and auxiliary caches invalidate after successful or failed builds', async (t) => {
  const root = temporary(t);
  const hre = await createHardhatRuntimeEnvironment(
    { plugins: [plugin], tre: { compiler: { target: 'evm' } } },
    {},
    root,
  );
  const hooks = await solidityHooks();
  assert.equal(
    await artifactsFor(hre, hre.config.paths.artifacts),
    hre.artifacts,
  );
  const nativeRoot = hre.config.tre.artifactPaths.tron;
  const native = await artifactsFor(hre, nativeRoot);
  writeArtifact(nativeRoot, 'src/First.sol');
  assert.equal((await native.readArtifact('Sample')).bytecode, '0x6000');
  await hooks.build(hre, [], {}, async () => {
    writeArtifact(nativeRoot, 'wrappers/Second.sol');
    return new Map();
  });
  await assert.rejects(native.readArtifact('Sample'), /multiple artifacts/i);
  assert.equal(
    (await native.readArtifact('src/First.sol:Sample')).bytecode,
    '0x6000',
  );
  writeArtifact(nativeRoot, 'src/First.sol', 'Sample', 'after', '0x6001');
  assert.equal(
    (await native.readArtifact('src/First.sol:Sample')).bytecode,
    '0x6001',
  );
  const original = new Error('EXPECTED_BUILD_FAILURE');
  await assert.rejects(
    hooks.build(hre, [], {}, async () => {
      writeArtifact(nativeRoot, 'src/Third.sol', 'Third');
      throw original;
    }),
    (error) => error === original,
  );
  assert.equal((await native.readArtifact('Third')).contractName, 'Third');
  writeArtifact(hre.config.paths.artifacts, 'src/Local.sol');
  await hre.artifacts.readArtifact('Sample');
  writeArtifact(hre.config.paths.artifacts, 'src/Other.sol');
  await hre.artifacts.clearCache();
  await assert.rejects(
    hre.artifacts.readArtifact('Sample'),
    /multiple artifacts/i,
  );
  const cleanupFailure = new Error('EXPECTED_CACHE_CLEANUP_FAILURE');
  const diagnostics = [];
  t.mock.method(hre.artifacts, 'clearCache', () => {
    throw cleanupFailure;
  });
  t.mock.method(console, 'error', (...args) => diagnostics.push(args));
  await assert.rejects(
    hooks.build(hre, [], {}, async () => {
      writeArtifact(nativeRoot, 'src/Fourth.sol', 'Fourth');
      throw original;
    }),
    (error) => error === original,
  );
  assert.equal((await native.readArtifact('Fourth')).contractName, 'Fourth');
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0][1].errors, [cleanupFailure]);
});

test('TRON connections read native artifacts when the selected compiler target is EVM', async (t) => {
  const root = temporary(t);
  t.mock.method(globalThis, 'fetch', async (url) =>
    Response.json(
      new URL(url).pathname.endsWith('getnodeinfo')
        ? { configNodeInfo: { codeVersion: 'test' } }
        : { block_header: { raw_data: { number: 1 } } },
    ),
  );
  const hre = await createHardhatRuntimeEnvironment(
    {
      plugins: [plugin],
      tre: { compiler: { target: 'evm' }, fundSigners: false },
      networks: {
        tre: {
          type: 'http',
          tron: true,
          url: 'http://example.invalid/jsonrpc',
          accounts: ['0x' + '1'.padStart(64, '0')],
        },
        evm: { type: 'edr-simulated' },
      },
    },
    {},
    root,
  );
  writeArtifact(
    hre.config.tre.artifactPaths.evm,
    'src/Native.sol',
    'Sample',
    'evmMethod',
    '0x6000',
  );
  writeArtifact(
    hre.config.tre.artifactPaths.tron,
    'src/Native.sol',
    'Sample',
    'tronMethod',
    '0x6001',
  );
  const native = await hre.network.create('tre');
  t.after(() => native.close());
  const evm = await hre.network.create('evm');
  t.after(() => evm.close());
  const nativeFactory = await native.ethers.getContractFactory('Sample');
  assert.equal(nativeFactory.bytecode, '0x6001');
  assert.ok(nativeFactory.interface.getFunction('tronMethod'));
  const evmFactory = await evm.ethers.getContractFactory('Sample');
  assert.equal(evmFactory.bytecode, '0x6000');
  assert.ok(evmFactory.interface.getFunction('evmMethod'));
});
