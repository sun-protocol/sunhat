import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
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
  runCompileTask,
  SunhatBuildError,
  validateSnapshot,
} from '../src/v2/build/index.js';
import type {
  BackendBuildResult,
  SolidityBuildBackend,
  SolidityBuildRequest,
} from '../src/v2/build/index.js';
import {
  normalizeSunhatConfig,
  SunhatConfigError,
} from '../src/v2/config/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe('Sunhat P2 build coordinator', () => {
  it('rejects target names that could escape isolated output directories', async () => {
    const projectRoot = await projectFixture();
    const coordinator = new BuildCoordinator({
      solidity: new FakeSolidityBackend(),
    });

    await assert.rejects(
      () =>
        coordinator.build({
          projectRoot,
          target: evmTarget(),
          targetName: '../outside',
        }),
      buildError('UNSUPPORTED_SOURCE_LAYOUT')
    );
  });

  it('rejects a second native Solidity configuration source', async () => {
    await assert.rejects(
      () =>
        runCompileTask(
          {},
          {
            config: {
              paths: { root: '/unused' },
              sunhat: normalizeSunhatConfig({
                compilation: {
                  targets: {
                    evm: {
                      chain: 'evm',
                      sources: ['contracts'],
                      compilers: [
                        { id: 'solc', kind: 'solc', version: '0.8.25' },
                      ],
                    },
                  },
                },
              }),
            },
            globalOptions: {},
            userConfig: { solidity: { version: '0.8.25' } },
          },
          new FakeSolidityBackend()
        ),
      (error: unknown) => {
        assert.ok(error instanceof SunhatConfigError);
        assert.equal(error.configPath, 'solidity');
        return true;
      }
    );
  });

  it('creates a target-isolated immutable snapshot and reuses it by build id', async () => {
    const projectRoot = await projectFixture();
    const backend = new FakeSolidityBackend();
    const coordinator = new BuildCoordinator({ solidity: backend });
    const target = evmTarget();

    const first = await coordinator.build({
      projectRoot,
      target,
      targetName: 'evm',
    });
    const second = await coordinator.build({
      projectRoot,
      target,
      targetName: 'evm',
    });

    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(second.buildId, first.buildId);
    assert.equal(backend.requests.length, 1);
    assert.equal(
      first.artifactDirectory,
      path.join(await realpath(projectRoot), 'artifacts', 'sunhat', 'evm')
    );
    const manifest = await validateSnapshot(first.snapshotDirectory, first.buildId);
    assert.equal(manifest.schema, 'sunhat-build-snapshot-2');
    assert.equal(manifest.build.target, 'evm');
    assert.equal(manifest.build.sources[0].sha256.length, 64);
    assert.match(
      await readFile(
        path.join(first.snapshotDirectory, 'sources', 'contracts', 'Counter.sol'),
        'utf8'
      ),
      /contract Counter/
    );
  });

  it('invalidates the build id when source content changes', async () => {
    const projectRoot = await projectFixture();
    const backend = new FakeSolidityBackend();
    const coordinator = new BuildCoordinator({ solidity: backend });
    const target = evmTarget();
    const first = await coordinator.build({ projectRoot, target, targetName: 'evm' });

    await writeFile(
      path.join(projectRoot, 'contracts', 'Counter.sol'),
      'pragma solidity 0.8.25; contract Counter { uint256 public value = 2; }\n'
    );
    const second = await coordinator.build({ projectRoot, target, targetName: 'evm' });

    assert.notEqual(second.buildId, first.buildId);
    assert.equal(backend.requests.length, 2);
  });

  it('does not inspect a configured Vyper environment when no Vyper source exists', async () => {
    const projectRoot = await projectFixture();
    const target = normalizeSunhatConfig({
      compilation: {
        targets: {
          evm: {
            chain: 'evm',
            sources: ['contracts'],
            compilers: [
              { id: 'solc', kind: 'solc', version: '0.8.25' },
              {
                id: 'unused-vyper',
                kind: 'vyper',
                path: '/definitely/missing/vyper-json',
                sha256: '0'.repeat(64),
                version: '0.4.3',
              },
            ],
          },
        },
      },
    }).compilation.targets.evm;
    const coordinator = new BuildCoordinator({
      solidity: new FakeSolidityBackend(),
    });

    const result = await coordinator.build({
      projectRoot,
      target,
      targetName: 'evm',
    });
    assert.equal(result.cacheHit, false);
  });

  it('keeps same-name contracts isolated between targets', async () => {
    const projectRoot = await projectFixture();
    const backend = new FakeSolidityBackend();
    const coordinator = new BuildCoordinator({ solidity: backend });
    const target = evmTarget();

    const evm = await coordinator.build({ projectRoot, target, targetName: 'evm' });
    const rollup = await coordinator.build({
      projectRoot,
      target,
      targetName: 'rollup',
    });

    assert.notEqual(evm.buildId, rollup.buildId);
    assert.notEqual(evm.artifactDirectory, rollup.artifactDirectory);
    assert.match(evm.snapshotDirectory, /build-snapshots\/evm\//);
    assert.match(rollup.snapshotDirectory, /build-snapshots\/rollup\//);
  });

  it('rejects a custom compiler whose executable hash changed', async () => {
    const projectRoot = await projectFixture();
    const compilerPath = path.join(projectRoot, 'compiler');
    await writeFile(compilerPath, 'unexpected compiler bytes');
    const target = normalizeSunhatConfig({
      compilation: {
        targets: {
          evm: {
            chain: 'evm',
            sources: ['contracts'],
            compilers: [
              {
                id: 'custom-solc',
                kind: 'solc',
                version: '0.8.25',
                path: compilerPath,
                sha256: '0'.repeat(64),
              },
            ],
          },
        },
      },
    }).compilation.targets.evm;
    const coordinator = new BuildCoordinator({
      solidity: new FakeSolidityBackend(),
    });

    await assert.rejects(
      () => coordinator.build({ projectRoot, target, targetName: 'evm' }),
      buildError('COMPILER_INTEGRITY_MISMATCH')
    );
  });

  it('removes stale artifacts and records diagnostics after a failed build', async () => {
    const projectRoot = await projectFixture();
    const artifactDirectory = path.join(projectRoot, 'artifacts', 'sunhat', 'evm');
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(path.join(artifactDirectory, 'stale.json'), '{}\n');
    const coordinator = new BuildCoordinator({
      solidity: {
        async build() {
          throw new SunhatBuildError('BUILD_FAILED', 'synthetic failure', [
            { file: 'contracts/Counter.sol', message: 'bad source', severity: 'error' },
          ]);
        },
      },
    });

    await assert.rejects(
      () =>
        coordinator.build({
          projectRoot,
          target: evmTarget(),
          targetName: 'evm',
        }),
      buildError('BUILD_FAILED')
    );
    await assert.rejects(() => readFile(path.join(artifactDirectory, 'stale.json')));
    const diagnostics = JSON.parse(
      await readFile(
        path.join(artifactDirectory, 'compilation-errors.json'),
        'utf8'
      )
    );
    assert.equal(diagnostics.diagnostics[0].message, 'bad source');
  });

  it('detects snapshot tampering before a cache hit', async () => {
    const projectRoot = await projectFixture();
    const coordinator = new BuildCoordinator({
      solidity: new FakeSolidityBackend(),
    });
    const result = await coordinator.build({
      projectRoot,
      target: evmTarget(),
      targetName: 'evm',
    });
    const artifact = path.join(
      result.snapshotDirectory,
      'artifacts',
      'solidity',
      'contracts',
      'Counter.sol',
      'Counter.json'
    );
    await writeFile(artifact, '{"tampered":true}\n');

    await assert.rejects(
      () =>
        coordinator.build({
          projectRoot,
          target: evmTarget(),
          targetName: 'evm',
        }),
      buildError('SNAPSHOT_INTEGRITY_MISMATCH')
    );
  });

  it('rejects files injected into an immutable snapshot', async () => {
    const projectRoot = await projectFixture();
    const coordinator = new BuildCoordinator({
      solidity: new FakeSolidityBackend(),
    });
    const result = await coordinator.build({
      projectRoot,
      target: evmTarget(),
      targetName: 'evm',
    });
    await writeFile(path.join(result.snapshotDirectory, 'injected.json'), '{}\n');

    await assert.rejects(
      () => validateSnapshot(result.snapshotDirectory, result.buildId),
      buildError('SNAPSHOT_INTEGRITY_MISMATCH')
    );
  });

  it('rejects a manifest whose source index was rewritten', async () => {
    const projectRoot = await projectFixture();
    const coordinator = new BuildCoordinator({
      solidity: new FakeSolidityBackend(),
    });
    const result = await coordinator.build({
      projectRoot,
      target: evmTarget(),
      targetName: 'evm',
    });
    const manifestPath = path.join(result.snapshotDirectory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.build.sources[0].sha256 = '0'.repeat(64);
    await writeFile(manifestPath, `${canonicalJson(manifest)}\n`);

    await assert.rejects(
      () => validateSnapshot(result.snapshotDirectory, result.buildId),
      buildError('SNAPSHOT_INTEGRITY_MISMATCH')
    );
  });

  it('binds manifest chain metadata to the build id', async () => {
    const projectRoot = await projectFixture();
    const coordinator = new BuildCoordinator({
      solidity: new FakeSolidityBackend(),
    });
    const result = await coordinator.build({
      projectRoot,
      target: evmTarget(),
      targetName: 'evm',
    });
    const manifestPath = path.join(result.snapshotDirectory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.build.chain = 'tron';
    await writeFile(manifestPath, `${canonicalJson(manifest)}\n`);

    await assert.rejects(
      () => validateSnapshot(result.snapshotDirectory, result.buildId),
      buildError('SNAPSHOT_INTEGRITY_MISMATCH')
    );
  });

  it('rejects symbolic links inside configured source roots', async () => {
    const projectRoot = await projectFixture();
    await symlink(
      path.join(projectRoot, 'contracts', 'Counter.sol'),
      path.join(projectRoot, 'contracts', 'Alias.sol')
    );
    const coordinator = new BuildCoordinator({
      solidity: new FakeSolidityBackend(),
    });

    await assert.rejects(
      () =>
        coordinator.build({
          projectRoot,
          target: evmTarget(),
          targetName: 'evm',
        }),
      buildError('UNSUPPORTED_SOURCE_LAYOUT')
    );
  });
});

class FakeSolidityBackend implements SolidityBuildBackend {
  public readonly requests: SolidityBuildRequest[] = [];

  public async build(request: SolidityBuildRequest): Promise<BackendBuildResult> {
    this.requests.push(request);
    const outputPath = path.join(
      request.artifactDirectory,
      'contracts',
      'Counter.sol',
      'Counter.json'
    );
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${canonicalJson({ _format: 'hh3-artifact-1', target: request.targetName })}\n`
    );
    return {
      diagnostics: [],
      metadata: { compilerKind: request.compilerKind },
    };
  }
}

async function projectFixture(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'sunhat-p2-'));
  temporaryDirectories.push(projectRoot);
  await mkdir(path.join(projectRoot, 'contracts'), { recursive: true });
  await writeFile(
    path.join(projectRoot, 'contracts', 'Counter.sol'),
    'pragma solidity 0.8.25; contract Counter { uint256 public value = 1; }\n'
  );
  return projectRoot;
}

function evmTarget() {
  return normalizeSunhatConfig({
    compilation: {
      targets: {
        evm: {
          chain: 'evm',
          sources: ['contracts'],
          compilers: [
            { id: 'solc', kind: 'solc', version: '0.8.25', settings: {} },
          ],
        },
      },
    },
  }).compilation.targets.evm;
}

function buildError(code: SunhatBuildError['code']) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof SunhatBuildError);
    assert.equal(error.code, code);
    return true;
  };
}
