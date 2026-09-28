import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  BuildCoordinator,
  canonicalJson,
  sha256,
} from '../src/v2/build/index.js';
import type {
  BackendBuildResult,
  SolidityBuildBackend,
  SolidityBuildRequest,
} from '../src/v2/build/index.js';
import { normalizeSunhatConfig } from '../src/v2/config/index.js';
import {
  compareRuntimeCode,
  DeploymentManager,
  EvmAdapter,
  SunhatDeploymentError,
  TronAdapter,
} from '../src/v2/deploy/index.js';
import type {
  BroadcastResult,
  DeploymentPlan,
  DeploymentReceipt,
  DeploymentTransaction,
  NetworkAdapter,
  NetworkIdentity,
  OnchainCode,
} from '../src/v2/deploy/index.js';

const temporaryDirectories: string[] = [];
const runtimeCode = '0x6001600055';

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe('Sunhat P3 deployment state machine', () => {
  it('persists an EVM attempt before broadcast and archives immutable snapshot inputs', async () => {
    const fixture = await deploymentFixture('evm');
    const adapter = new FakeAdapter('evm', fixture.projectRoot);
    const manager = new DeploymentManager({
      adapter: new EvmAdapter(adapter.client()),
      projectRoot: fixture.projectRoot,
      sourceMode: 'both',
    });

    const result = await manager.deploy(fixture.plan);
    assert.equal(adapter.attemptExistedBeforeBroadcast, true);
    assert.equal(result.runtimeMatch.status, 'exact');
    assert.match(result.verificationDirectory, /verfication-0x[a-f0-9]{40}$/);

    await writeFile(
      path.join(fixture.projectRoot, 'contracts', 'Counter.sol'),
      'pragma solidity 0.8.25; contract Counter { function changed() external {} }\n'
    );
    assert.match(
      await readFile(
        path.join(result.verificationDirectory, 'sources', 'contracts', 'Counter.sol'),
        'utf8'
      ),
      /uint256 public value/
    );
    const manifest = JSON.parse(
      await readFile(path.join(result.verificationDirectory, 'manifest.json'), 'utf8')
    );
    assert.equal(manifest.transactionId, adapter.transactionId);
    assert.equal(manifest.sourceMode, 'both');
    assert.equal(manifest.flattenStatus, 'unverified-export');
    assert.match(
      await readFile(
        path.join(result.verificationDirectory, 'flattened', 'Counter.flattened.sol'),
        'utf8'
      ),
      /UNVERIFIED FLATTENED EXPORT/
    );
    assert.ok(manifest.files.some((file: { path: string }) =>
      file.path.includes('build-info/input.json')
    ));
    assert.ok(manifest.files.some((file: { path: string }) =>
      file.path === 'build-info/solidity/input.json'
    ), manifest.files.map((file: { path: string }) => file.path).join('\n'));
    assert.ok(!manifest.files.some((file: { path: string }) =>
      file.path === 'manifest.json'
    ));
  });

  it('archives a TRON deployment without inheriting ethers provider semantics', async () => {
    const fixture = await deploymentFixture('tron');
    const adapter = new FakeAdapter('tron', fixture.projectRoot);
    const manager = new DeploymentManager({
      adapter: new TronAdapter(adapter.client()),
      projectRoot: fixture.projectRoot,
    });

    const result = await manager.deploy(fixture.plan);
    assert.equal(result.address, adapter.address);
    const deployment = JSON.parse(
      await readFile(path.join(result.verificationDirectory, 'deployment.json'), 'utf8')
    );
    assert.equal(deployment.value, '1000000');
    assert.equal(typeof deployment.value, 'string');
  });

  it('never rebroadcasts an unknown outcome and recovers through sync', async () => {
    const fixture = await deploymentFixture('evm');
    const adapter = new FakeAdapter('evm', fixture.projectRoot);
    adapter.broadcastError = new Error('connection closed after send');
    const manager = new DeploymentManager({
      adapter,
      projectRoot: fixture.projectRoot,
    });
    let attemptId = '';
    await assert.rejects(
      () => manager.deploy(fixture.plan),
      (error: unknown) => {
        assert.ok(error instanceof SunhatDeploymentError);
        assert.equal(error.code, 'BROADCAST_UNKNOWN');
        attemptId = error.details?.attemptId ?? '';
        return true;
      }
    );
    assert.equal(adapter.broadcastCount, 1);

    await assert.rejects(
      () => manager.deploy(fixture.plan),
      deploymentError('ATTEMPT_CONFLICT')
    );
    assert.equal(adapter.broadcastCount, 1);

    adapter.broadcastError = undefined;
    const result = await manager.sync(attemptId);
    assert.equal(result.transactionId, adapter.transactionId);
    assert.equal(adapter.broadcastCount, 1);
  });

  it('does not create a success archive for a reverted receipt', async () => {
    const fixture = await deploymentFixture('evm');
    const adapter = new FakeAdapter('evm', fixture.projectRoot);
    adapter.receiptStatus = 'failure';
    const manager = new DeploymentManager({
      adapter,
      projectRoot: fixture.projectRoot,
    });

    await assert.rejects(
      () => manager.deploy(fixture.plan),
      deploymentError('RECEIPT_FAILED')
    );
    const networkDirectories = await readdir(
      path.join(fixture.projectRoot, 'verification')
    );
    assert.equal(networkDirectories.length, 1);
    assert.deepEqual(
      await readdir(
        path.join(fixture.projectRoot, 'verification', networkDirectories[0])
      ),
      []
    );
  });

  it('reports chain success and archive failure as a recoverable distinct state', async () => {
    const fixture = await deploymentFixture('evm');
    const adapter = new FakeAdapter('evm', fixture.projectRoot);
    adapter.addressOverride = '0x1234';
    const manager = new DeploymentManager({
      adapter,
      projectRoot: fixture.projectRoot,
    });

    await assert.rejects(
      () => manager.deploy(fixture.plan),
      (error: unknown) => {
        assert.ok(error instanceof SunhatDeploymentError);
        assert.equal(error.code, 'ARCHIVE_FAILED');
        assert.equal(error.details?.address, adapter.addressOverride);
        assert.equal(error.details?.transactionId, adapter.transactionId);
        assert.ok(error.details?.attemptId);
        return true;
      }
    );
  });

  it('rejects an unsafe verification path before broadcasting', async () => {
    const fixture = await deploymentFixture('evm');
    const adapter = new FakeAdapter('evm', fixture.projectRoot);
    const manager = new DeploymentManager({
      adapter,
      outputDirectory: path.join(fixture.projectRoot, '..', 'escaped'),
      projectRoot: fixture.projectRoot,
    });

    await assert.rejects(
      () => manager.deploy(fixture.plan),
      deploymentError('UNSAFE_ARCHIVE_PATH')
    );
    assert.equal(adapter.broadcastCount, 0);
  });

  it('rejects initcode that is not bound to the selected snapshot', async () => {
    const fixture = await deploymentFixture('evm');
    const adapter = new FakeAdapter('evm', fixture.projectRoot);
    const manager = new DeploymentManager({ adapter, projectRoot: fixture.projectRoot });

    await assert.rejects(
      () => manager.deploy({ ...fixture.plan, initCode: '0x6001' }),
      deploymentError('SNAPSHOT_MISMATCH')
    );
    assert.equal(adapter.broadcastCount, 0);
  });

  it('rejects a verification parent symlink before broadcasting', async () => {
    const fixture = await deploymentFixture('evm');
    const outside = await mkdtemp(path.join(os.tmpdir(), 'sunhat-p3-outside-'));
    temporaryDirectories.push(outside);
    await symlink(outside, path.join(fixture.projectRoot, 'verification'));
    const adapter = new FakeAdapter('evm', fixture.projectRoot);
    const manager = new DeploymentManager({ adapter, projectRoot: fixture.projectRoot });

    await assert.rejects(
      () => manager.deploy(fixture.plan),
      deploymentError('UNSAFE_ARCHIVE_PATH')
    );
    assert.equal(adapter.broadcastCount, 0);
  });

  it('makes verification sync idempotent for the same transaction and snapshot', async () => {
    const fixture = await deploymentFixture('evm');
    const adapter = new FakeAdapter('evm', fixture.projectRoot);
    const manager = new DeploymentManager({
      adapter,
      projectRoot: fixture.projectRoot,
    });
    const deployed = await manager.deploy(fixture.plan);
    const synced = await manager.syncByTransactionId(deployed.transactionId);

    assert.equal(synced.verificationDirectory, deployed.verificationDirectory);
    assert.equal(synced.transactionId, deployed.transactionId);
    assert.equal(adapter.broadcastCount, 1);
  });
});

describe('Sunhat P3 runtime comparison', () => {
  it('only normalizes explicitly declared link or immutable byte ranges', () => {
    assert.equal(compareRuntimeCode('0x600000', '0x600000').status, 'exact');
    assert.equal(
      compareRuntimeCode('0x600000', '0x60ffff', [{ start: 1, length: 2 }]).status,
      'normalized'
    );
    assert.equal(compareRuntimeCode('0x600000', '0x60ffff').status, 'mismatch');
    assert.equal(
      compareRuntimeCode('0x600000', '0x61ffff', [{ start: 1, length: 2 }]).status,
      'mismatch'
    );
    assert.equal(compareRuntimeCode(undefined, '0x60').status, 'insufficient');
  });
});

class FakeAdapter implements NetworkAdapter {
  public readonly address: string;
  public addressOverride?: string;
  public attemptExistedBeforeBroadcast = false;
  public broadcastCount = 0;
  public broadcastError?: Error;
  public readonly chain: 'evm' | 'tron';
  public receiptStatus: DeploymentReceipt['status'] = 'success';
  public readonly transactionId = `0x${'2'.repeat(64)}`;
  readonly #projectRoot: string;

  public constructor(chain: 'evm' | 'tron', projectRoot: string) {
    this.chain = chain;
    this.#projectRoot = projectRoot;
    this.address = chain === 'evm' ? `0x${'1'.repeat(40)}` : `T${'1'.repeat(33)}`;
  }

  public client() {
    return {
      broadcast: (transaction: DeploymentTransaction) => this.broadcast(transaction),
      getCode: async (_address: string) => runtimeCode,
      getNetworkIdentity: async () => {
        const { chain: _chain, ...identity } = await this.getNetworkIdentity();
        return identity;
      },
      getReceipt: (transactionId: string, confirmations: number) =>
        this.getReceipt(transactionId, confirmations),
      prepareDeployment: (plan: DeploymentPlan) => this.prepareDeployment(plan),
    };
  }

  public async getNetworkIdentity(): Promise<NetworkIdentity> {
    return {
      chain: this.chain,
      chainId: this.chain === 'evm' ? '31337' : '728126428',
      genesisHash: this.chain === 'evm' ? `0x${'a'.repeat(64)}` : 'tron-nile-fixture',
      name: `${this.chain}-fixture`,
    };
  }

  public async prepareDeployment(plan: DeploymentPlan): Promise<DeploymentTransaction> {
    return {
      data: plan.initCode,
      from: this.chain === 'evm' ? `0x${'3'.repeat(40)}` : `T${'2'.repeat(33)}`,
      method: 'create',
      nonce: '7',
      recoveryId: `${this.chain}:sender:7`,
      transactionId: this.transactionId,
      value: plan.value ?? '0',
    };
  }

  public async broadcast(_transaction: DeploymentTransaction): Promise<BroadcastResult> {
    this.broadcastCount += 1;
    const attemptsRoot = path.join(
      this.#projectRoot,
      'deployments',
      '.sunhat',
      'attempts'
    );
    const networks = await readdir(attemptsRoot);
    const attempts = await readdir(path.join(attemptsRoot, networks[0]));
    this.attemptExistedBeforeBroadcast = attempts.some((name) => name.endsWith('.json'));
    if (this.broadcastError) throw this.broadcastError;
    return { transactionId: this.transactionId };
  }

  public async getReceipt(
    transactionId: string,
    confirmations: number
  ): Promise<DeploymentReceipt> {
    return {
      ...(this.receiptStatus === 'success'
        ? { address: this.addressOverride ?? this.address }
        : {}),
      blockHash: `0x${'4'.repeat(64)}`,
      blockNumber: '9',
      confirmations,
      raw: {
        energyUsageTotal: this.chain === 'tron' ? '12345' : '0',
        transactionId,
      },
      status: this.receiptStatus,
      transactionId,
    };
  }

  public async getCode(address: string): Promise<OnchainCode> {
    return { address, code: runtimeCode };
  }
}

async function deploymentFixture(chain: 'evm' | 'tron') {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), `sunhat-p3-${chain}-`));
  temporaryDirectories.push(projectRoot);
  await mkdir(path.join(projectRoot, 'contracts'), { recursive: true });
  await writeFile(
    path.join(projectRoot, 'contracts', 'Counter.sol'),
    'pragma solidity 0.8.25; contract Counter { uint256 public value = 1; }\n'
  );
  const tronCompilerPath = path.join(projectRoot, 'tron-solc');
  await writeFile(tronCompilerPath, 'test-only tron compiler identity\n');
  const coordinator = new BuildCoordinator({ solidity: new DeploymentBackend() });
  const target = normalizeSunhatConfig({
    compilation: {
      targets: {
        [chain]: {
          chain,
          compilers: [
            {
              id: chain === 'evm' ? 'solc' : 'tron-solc',
              kind: chain === 'evm' ? 'solc' : 'tron-solc',
              ...(chain === 'tron'
                ? {
                    path: tronCompilerPath,
                    sha256: sha256('test-only tron compiler identity\n'),
                  }
                : {}),
              version: '0.8.25',
            },
          ],
          sources: ['contracts'],
        },
      },
    },
  }).compilation.targets[chain];
  const build = await coordinator.build({ projectRoot, target, targetName: chain });
  const plan: DeploymentPlan = {
    buildId: build.buildId,
    confirmations: 2,
    constructorArguments: ['1'],
    encodedConstructorArguments: '0x',
    fullyQualifiedName: 'contracts/Counter.sol:Counter',
    initCode: '0x6000',
    projectRoot,
    snapshotDirectory: build.snapshotDirectory,
    target: chain,
    value: chain === 'tron' ? '1000000' : '0',
  };
  return { plan, projectRoot };
}

class DeploymentBackend implements SolidityBuildBackend {
  public async build(request: SolidityBuildRequest): Promise<BackendBuildResult> {
    const artifactPath = path.join(
      request.artifactDirectory,
      'contracts',
      'Counter.sol',
      'Counter.json'
    );
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      `${canonicalJson({
        _format: 'hh3-artifact-1',
        abi: [],
        bytecode: '0x6000',
        contractName: 'Counter',
        deployedBytecode: runtimeCode,
        deployedLinkReferences: {},
        immutableReferences: {},
        sourceName: 'contracts/Counter.sol',
      })}\n`
    );
    const buildInfo = path.join(
      request.artifactDirectory,
      'build-info'
    );
    await mkdir(buildInfo, { recursive: true });
    await writeFile(
      path.join(buildInfo, 'input.json'),
      `${canonicalJson({ language: 'Solidity', sources: {} })}\n`
    );
    await writeFile(
      path.join(buildInfo, 'output.json'),
      `${canonicalJson({ contracts: {} })}\n`
    );
    return { diagnostics: [], metadata: { compilerVersion: '0.8.25' } };
  }
}

function deploymentError(code: SunhatDeploymentError['code']) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof SunhatDeploymentError);
    assert.equal(error.code, code);
    return true;
  };
}
