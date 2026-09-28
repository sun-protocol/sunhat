import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { canonicalJson } from '../src/v2/build/index.js';
import type {
  BackendBuildResult,
  SolidityBuildBackend,
  SolidityBuildRequest,
} from '../src/v2/build/index.js';
import { normalizeSunhatConfig, SunhatConfigError } from '../src/v2/config/index.js';
import { runSunhatTestTask } from '../src/v2/test/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe('Sunhat P4 test task', () => {
  it('builds sunhat.test.target once and disables the runner compiler', async () => {
    const projectRoot = await projectFixture();
    const backend = new FakeBackend();
    let runnerArguments: unknown;
    const result = await runSunhatTestTask(
      {
        grep: 'increments',
        testFiles: ['test/Counter.ts'],
      },
      environment(projectRoot, twoTargetConfig()),
      backend,
      async (arguments_) => {
        runnerArguments = arguments_;
        return { failed: 0, passed: 1 };
      }
    );

    assert.equal(result.build.targetName, 'tests');
    assert.equal(backend.requests.length, 1);
    assert.equal(backend.requests[0].targetName, 'tests');
    assert.deepEqual(runnerArguments, {
      grep: 'increments',
      noCompile: true,
      testFiles: ['test/Counter.ts'],
    });
  });

  it('honors an explicit target over sunhat.test.target', async () => {
    const projectRoot = await projectFixture();
    const backend = new FakeBackend();
    const result = await runSunhatTestTask(
      { target: 'default' },
      environment(projectRoot, twoTargetConfig()),
      backend,
      async () => 'ok'
    );

    assert.equal(result.build.targetName, 'default');
    assert.equal(result.runnerResult, 'ok');
  });

  it('requires an explicit TVM network before building a TRON test target', async () => {
    const projectRoot = await projectFixture();
    const backend = new FakeBackend();
    const config = normalizeSunhatConfig({
      compilation: {
        targets: {
          tron: {
            chain: 'tron',
            compilers: [
              {
                id: 'tron-solc',
                kind: 'tron-solc',
                path: '/tmp/tron-solc',
                sha256: '0'.repeat(64),
                version: '0.8.25',
              },
            ],
            sources: ['contracts'],
          },
        },
      },
      test: { target: 'tron' },
    });

    await assert.rejects(
      () =>
        runSunhatTestTask(
          {},
          environment(projectRoot, config),
          backend,
          async () => undefined
        ),
      (error: unknown) => {
        assert.ok(error instanceof SunhatConfigError);
        assert.equal(error.code, 'TRON_TEST_NETWORK_REQUIRED');
        return true;
      }
    );
    assert.equal(backend.requests.length, 0);
  });

  it('propagates the test runner failure without invoking another build', async () => {
    const projectRoot = await projectFixture();
    const backend = new FakeBackend();
    const failure = new Error('synthetic test failure');

    await assert.rejects(
      () =>
        runSunhatTestTask(
          {},
          environment(projectRoot, singleTargetConfig()),
          backend,
          async () => {
            throw failure;
          }
        ),
      (error: unknown) => error === failure
    );
    assert.equal(backend.requests.length, 1);
  });
});

class FakeBackend implements SolidityBuildBackend {
  public readonly requests: SolidityBuildRequest[] = [];

  public async build(request: SolidityBuildRequest): Promise<BackendBuildResult> {
    this.requests.push(request);
    const artifact = path.join(
      request.artifactDirectory,
      'contracts',
      'Counter.sol',
      'Counter.json'
    );
    await mkdir(path.dirname(artifact), { recursive: true });
    await writeFile(
      artifact,
      `${canonicalJson({
        _format: 'hh3-artifact-1',
        contractName: 'Counter',
        sourceName: 'contracts/Counter.sol',
      })}\n`
    );
    return { diagnostics: [], metadata: { target: request.targetName } };
  }
}

async function projectFixture(): Promise<string> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'sunhat-p4-test-'));
  temporaryDirectories.push(projectRoot);
  await mkdir(path.join(projectRoot, 'contracts'), { recursive: true });
  await writeFile(
    path.join(projectRoot, 'contracts', 'Counter.sol'),
    'pragma solidity 0.8.25; contract Counter {}\n'
  );
  return projectRoot;
}

function environment(
  projectRoot: string,
  config: ReturnType<typeof normalizeSunhatConfig>
) {
  return {
    config: { paths: { root: projectRoot }, sunhat: config },
    globalOptions: {},
    userConfig: {},
  };
}

function compiler() {
  return { id: 'solc', kind: 'solc' as const, version: '0.8.25' };
}

function singleTargetConfig() {
  return normalizeSunhatConfig({
    compilation: {
      targets: {
        tests: {
          chain: 'evm',
          compilers: [compiler()],
          sources: ['contracts'],
        },
      },
    },
  });
}

function twoTargetConfig() {
  return normalizeSunhatConfig({
    compilation: {
      defaultTarget: 'default',
      targets: {
        default: {
          chain: 'evm',
          compilers: [compiler()],
          sources: ['contracts'],
        },
        tests: {
          chain: 'evm',
          compilers: [compiler()],
          sources: ['contracts'],
        },
      },
    },
    test: { target: 'tests' },
  });
}
