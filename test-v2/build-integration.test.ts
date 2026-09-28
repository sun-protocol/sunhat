import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  BuildCoordinator,
  SunhatBuildError,
} from '../src/v2/build/index.js';
import { normalizeSunhatConfig } from '../src/v2/config/index.js';
import { Hardhat3SolidityBackend } from '../src/v2/hardhat/solidity-backend.js';

const tronSolcPath = requiredEnvironment('TRON_SOLC_PATH');
const tronSolcSha256 = requiredSha256('TRON_SOLC_SHA256');
const vyperPath = requiredEnvironment('VYPER_JSON_PATH');
const vyperSha256 = requiredSha256('VYPER_JSON_SHA256');
let projectRoot: string;

before(async () => {
  projectRoot = await createProject();
});

after(async () => {
  await rm(projectRoot, { force: true, recursive: true });
});

describe('Sunhat P2 real compiler integration', () => {
  it('builds mixed Solidity and Vyper EVM sources from an empty project cache', async () => {
    const coordinator = new BuildCoordinator({
      solidity: new Hardhat3SolidityBackend(),
    });
    const target = targets().evm;
    const result = await coordinator.build({
      projectRoot,
      target,
      targetName: 'evm',
    });

    assert.equal(result.cacheHit, false);
    assert.equal(
      await artifactFormat(
        path.join(
          result.artifactDirectory,
          'solidity',
          'contracts',
          'Counter.sol',
          'Counter.json'
        )
      ),
      'hh3-artifact-1'
    );
    assert.equal(
      await artifactFormat(
        path.join(
          result.artifactDirectory,
          'vyper',
          'contracts',
          'Depositer.vy',
          'Depositer.json'
        )
      ),
      'sunhat-vyper-artifact-1'
    );
    assert.match(
      await readFile(
        path.join(
          result.snapshotDirectory,
          'sources',
          'npm',
          'fixture-math@1.0.0',
          'Math.sol'
        ),
        'utf8'
      ),
      /library FixtureMath/
    );
  });

  it('builds tron-solc and Vyper into a separate TRON target', async () => {
    const coordinator = new BuildCoordinator({
      solidity: new Hardhat3SolidityBackend(),
    });
    const result = await coordinator.build({
      projectRoot,
      target: targets().tron,
      targetName: 'tron',
    });

    assert.equal(result.cacheHit, false);
    assert.notEqual(
      result.artifactDirectory,
      path.join(projectRoot, 'artifacts', 'sunhat', 'evm')
    );
    const buildInfoDirectory = path.join(
      result.artifactDirectory,
      'solidity',
      'build-info'
    );
    const buildInfoNames = await readdir(buildInfoDirectory);
    assert.ok(buildInfoNames.some((name) => name.endsWith('.output.json')));
  });

  it('invalidates a mixed-language target when an npm Solidity dependency changes', async () => {
    const coordinator = new BuildCoordinator({
      solidity: new Hardhat3SolidityBackend(),
    });
    const target = targets().evm;
    const before = await coordinator.build({
      projectRoot,
      target,
      targetName: 'evm',
    });
    await writeFile(
      path.join(projectRoot, 'node_modules', 'fixture-math', 'Math.sol'),
      dependencySource(3)
    );
    const afterChange = await coordinator.build({
      projectRoot,
      target,
      targetName: 'evm',
    });

    assert.notEqual(afterChange.buildId, before.buildId);
    assert.equal(afterChange.cacheHit, false);
  });

  it('does not expose prior successful artifacts after a compiler failure', async () => {
    const coordinator = new BuildCoordinator({
      solidity: new Hardhat3SolidityBackend(),
    });
    const target = targets().evm;
    const sourcePath = path.join(projectRoot, 'contracts', 'Counter.sol');
    const validSource = counterSource();
    const successful = await coordinator.build({
      projectRoot,
      target,
      targetName: 'evm',
    });
    await writeFile(sourcePath, 'pragma solidity 0.8.25; contract Counter {\n');

    await assert.rejects(
      () =>
        coordinator.build({
          force: true,
          projectRoot,
          target,
          targetName: 'evm',
        }),
      (error: unknown) =>
        error instanceof SunhatBuildError && error.code === 'BUILD_FAILED'
    );
    const diagnostics = JSON.parse(
      await readFile(
        path.join(
          projectRoot,
          'artifacts',
          'sunhat',
          'evm',
          'compilation-errors.json'
        ),
        'utf8'
      )
    );
    assert.equal(diagnostics.diagnostics[0].severity, 'error');
    assert.match(diagnostics.diagnostics[0].file, /contracts\/Counter\.sol$/);
    assert.equal(typeof diagnostics.diagnostics[0].line, 'number');
    assert.equal(typeof diagnostics.diagnostics[0].column, 'number');
    await assert.rejects(() =>
      readFile(
        path.join(
          projectRoot,
          'artifacts',
          'sunhat',
          'evm',
          'solidity',
          'contracts',
          'Counter.sol',
          'Counter.json'
        )
      )
    );

    await assert.rejects(
      () =>
        coordinator.build({
          force: true,
          projectRoot,
          target: targets().tron,
          targetName: 'tron',
        }),
      (error: unknown) =>
        error instanceof SunhatBuildError && error.code === 'BUILD_FAILED'
    );
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(
            projectRoot,
            'artifacts',
            'sunhat',
            'tron',
            'compilation-errors.json'
          ),
          'utf8'
        )
      ).diagnostics[0].severity,
      'error'
    );
    await assert.rejects(() =>
      readFile(
        path.join(
          projectRoot,
          'artifacts',
          'sunhat',
          'tron',
          'solidity',
          'contracts',
          'Counter.sol',
          'Counter.json'
        )
      )
    );

    await writeFile(sourcePath, validSource);
    const restored = await coordinator.build({
      projectRoot,
      target,
      targetName: 'evm',
    });
    assert.equal(restored.buildId, successful.buildId);
    assert.equal(restored.cacheHit, true);
  });

  it('normalizes Vyper compiler errors and removes mixed-language artifacts', async () => {
    const coordinator = new BuildCoordinator({
      solidity: new Hardhat3SolidityBackend(),
    });
    const target = targets().evm;
    const sourcePath = path.join(projectRoot, 'contracts', 'Depositer.vy');
    const validSource = await readFile(sourcePath, 'utf8');
    await writeFile(
      sourcePath,
      '# pragma version 0.4.3\n\n@external\ndef broken(:\n    pass\n'
    );

    await assert.rejects(
      () =>
        coordinator.build({
          force: true,
          projectRoot,
          target,
          targetName: 'evm',
        }),
      (error: unknown) =>
        error instanceof SunhatBuildError && error.code === 'BUILD_FAILED'
    );
    const diagnostics = JSON.parse(
      await readFile(
        path.join(
          projectRoot,
          'artifacts',
          'sunhat',
          'evm',
          'compilation-errors.json'
        ),
        'utf8'
      )
    ).diagnostics;
    const vyperError = diagnostics.find(
      (diagnostic: { file?: string }) =>
        diagnostic.file === 'contracts/Depositer.vy'
    );
    assert.equal(vyperError.severity, 'error');
    assert.equal(typeof vyperError.line, 'number');
    assert.equal(typeof vyperError.column, 'number');
    assert.equal(typeof vyperError.type, 'string');
    await assert.rejects(() =>
      readFile(
        path.join(
          projectRoot,
          'artifacts',
          'sunhat',
          'evm',
          'vyper',
          'contracts',
          'Depositer.vy',
          'Depositer.json'
        )
      )
    );
    await writeFile(sourcePath, validSource);
  });
});

function targets() {
  return normalizeSunhatConfig({
    compilation: {
      defaultTarget: 'evm',
      targets: {
        evm: {
          chain: 'evm',
          sources: ['contracts'],
          compilers: [
            {
              id: 'evm-solidity',
              kind: 'solc',
              settings: { optimizer: { enabled: true, runs: 200 } },
              version: '0.8.25',
            },
            {
              id: 'evm-vyper',
              kind: 'vyper',
              path: vyperPath,
              settings: { evmVersion: 'london', optimize: 'gas' },
              sha256: vyperSha256,
              version: '0.4.3',
            },
          ],
        },
        tron: {
          chain: 'tron',
          sources: ['contracts'],
          compilers: [
            {
              id: 'tron-solidity',
              kind: 'tron-solc',
              path: tronSolcPath,
              settings: {
                evmVersion: 'london',
                optimizer: { enabled: true, runs: 200 },
              },
              sha256: tronSolcSha256,
              version: '0.8.25',
            },
            {
              id: 'tron-vyper',
              kind: 'vyper',
              path: vyperPath,
              settings: { evmVersion: 'london', optimize: 'gas' },
              sha256: vyperSha256,
              version: '0.4.3',
            },
          ],
        },
      },
    },
  }).compilation.targets;
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sunhat-p2-integration-'));
  await Promise.all([
    mkdir(path.join(root, 'contracts'), { recursive: true }),
    mkdir(path.join(root, 'node_modules', 'fixture-math'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(root, 'package.json'),
      '{"name":"sunhat-p2-integration","private":true,"type":"module"}\n'
    ),
    writeFile(path.join(root, 'contracts', 'Counter.sol'), counterSource()),
    writeFile(
      path.join(root, 'node_modules', 'fixture-math', 'package.json'),
      '{"name":"fixture-math","version":"1.0.0"}\n'
    ),
    writeFile(
      path.join(root, 'node_modules', 'fixture-math', 'Math.sol'),
      dependencySource(2)
    ),
    writeFile(
      path.join(root, 'contracts', 'Depositer.vy'),
      [
        '# pragma version 0.4.3',
        '',
        'stored_value: public(uint256)',
        '',
        '@deploy',
        'def __init__(initial_value: uint256):',
        '    self.stored_value = initial_value',
        '',
      ].join('\n')
    ),
  ]);
  return root;
}

function counterSource(): string {
  return [
    '// SPDX-License-Identifier: MIT',
    'pragma solidity 0.8.25;',
    'import { FixtureMath } from "fixture-math/Math.sol";',
    'contract Counter {',
    '    function twice(uint256 value) external pure returns (uint256) {',
    '        return FixtureMath.multiply(value);',
    '    }',
    '}',
    '',
  ].join('\n');
}

function dependencySource(multiplier: number): string {
  return [
    '// SPDX-License-Identifier: MIT',
    'pragma solidity 0.8.25;',
    'library FixtureMath {',
    '    function multiply(uint256 value) internal pure returns (uint256) {',
    `        return value * ${multiplier};`,
    '    }',
    '}',
    '',
  ].join('\n');
}

async function artifactFormat(filePath: string): Promise<string> {
  return JSON.parse(await readFile(filePath, 'utf8'))._format;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || !path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  return value;
}

function requiredSha256(name: string): string {
  const value = requiredEnvironmentValue(name);
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${name} must contain 64 hexadecimal characters`);
  }
  return value.toLowerCase();
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}
