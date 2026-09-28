import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeSunhatConfig,
  resolveCompilationTargets,
  resolveTestTarget,
  SunhatConfigError,
} from '../src/v2/config/index.js';

const VYPER_PATH = '/opt/sunhat/vyper-json';
const SHA256 = 'a'.repeat(64);

interface MutableCompilerConfig {
  id: string;
  kind: 'solc' | 'tron-solc' | 'vyper';
  version: string;
  path?: string;
  sha256?: string;
  settings?: unknown;
}

interface MutableTargetConfig {
  chain: 'evm' | 'tron';
  sources: string[];
  compilers: MutableCompilerConfig[];
  overrides?: Record<string, string>;
}

interface MutableSunhatConfig {
  compilation: {
    defaultTarget?: string;
    targets: Record<string, MutableTargetConfig>;
  };
  test?: { target?: string };
}

describe('Sunhat 2.x config normalization', () => {
  it('normalizes defaults and freezes nested state', () => {
    const config = normalizeSunhatConfig(singleEvmConfig());

    assert.equal(config.verification.outputDir, 'verification');
    assert.equal(config.verification.sourceMode, 'multi-file');
    assert.equal(config.verification.autoExport, true);
    assert.ok(Object.isFrozen(config));
    assert.ok(Object.isFrozen(config.compilation.targets.evm.compilers));
  });

  it('normalizes project paths and compiler hashes', () => {
    const raw = singleEvmConfig();
    raw.compilation.targets.evm.sources = ['./contracts\\shared/'];
    raw.compilation.targets.evm.compilers.push({
      id: 'evm-vyper',
      kind: 'vyper',
      version: '0.4.3',
      path: VYPER_PATH,
      sha256: SHA256.toUpperCase(),
    });
    const config = normalizeSunhatConfig(raw);

    assert.deepEqual(config.compilation.targets.evm.sources, ['contracts/shared']);
    assert.equal(config.compilation.targets.evm.compilers[1].sha256, SHA256);
  });

  it('rejects project path traversal', () => {
    const raw = singleEvmConfig();
    raw.compilation.targets.evm.sources = ['../contracts'];
    assertConfigError(() => normalizeSunhatConfig(raw), 'INVALID_PATH');
  });

  it('rejects compiler and target chain mismatches', () => {
    const raw = singleEvmConfig();
    raw.compilation.targets.evm.compilers[0].kind = 'tron-solc';
    assertConfigError(
      () => normalizeSunhatConfig(raw),
      'COMPILER_CHAIN_MISMATCH'
    );
  });

  it('requires a Vyper executable hash and absolute path', () => {
    const raw = singleEvmConfig();
    raw.compilation.targets.evm.compilers = [
      { id: 'vyper', kind: 'vyper', version: '0.4.3' },
    ];
    assertConfigError(
      () => normalizeSunhatConfig(raw),
      'MISSING_COMPILER_INTEGRITY'
    );
  });

  it('rejects semver ranges and floating compiler versions', () => {
    const raw = singleEvmConfig();
    raw.compilation.targets.evm.compilers[0].version = '^0.8.25';
    assertConfigError(() => normalizeSunhatConfig(raw), 'INVALID_VERSION');
  });

  it('rejects non-object compiler settings', () => {
    const raw = singleEvmConfig();
    raw.compilation.targets.evm.compilers[0].settings = [];
    assertConfigError(() => normalizeSunhatConfig(raw), 'INVALID_CONFIG');
  });

  it('rejects duplicate compiler coordinates', () => {
    const raw = singleEvmConfig();
    raw.compilation.targets.evm.compilers.push({
      id: 'second-solc',
      kind: 'solc',
      version: '0.8.25',
      settings: { optimizer: { enabled: false } },
    });
    assertConfigError(() => normalizeSunhatConfig(raw), 'DUPLICATE_COMPILER');
  });

  it('rejects overrides that reference an unknown compiler', () => {
    const raw = singleEvmConfig();
    raw.compilation.targets.evm.overrides = {
      'contracts/Legacy.sol': 'missing',
    };
    assertConfigError(() => normalizeSunhatConfig(raw), 'INVALID_CONFIG');
  });

  it('rejects overrides that select a compiler for the wrong source language', () => {
    const raw = singleEvmConfig();
    raw.compilation.targets.evm.compilers.push({
      id: 'vyper',
      kind: 'vyper',
      version: '0.4.3',
      path: '/opt/vyper/bin/vyper-json',
      sha256: 'a'.repeat(64),
    });
    raw.compilation.targets.evm.overrides = {
      'contracts/Counter.sol': 'vyper',
    };
    assertConfigError(
      () => normalizeSunhatConfig(raw),
      'COMPILER_CHAIN_MISMATCH'
    );
  });

  it('rejects TRON targets bound to an EDR network', () => {
    const raw = dualTargetConfig();
    assertConfigError(
      () =>
        normalizeSunhatConfig(raw, {
          tron: {
            type: 'edr-simulated',
            chainType: 'l1',
            sunhat: { target: 'tron' },
          },
        }),
      'INVALID_NETWORK_BINDING'
    );
  });
});

describe('Sunhat 2.x compilation target resolution', () => {
  it('uses an explicit target before the configured default', () => {
    const config = normalizeSunhatConfig(dualTargetConfig());
    const [selection] = resolveCompilationTargets(config, { target: 'evm' });

    assert.equal(selection.name, 'evm');
    assert.equal(selection.reason, 'explicit-target');
  });

  it('selects the target bound to an explicit network', () => {
    const config = normalizeSunhatConfig(dualTargetConfig(), validNetworks());
    const [selection] = resolveCompilationTargets(config, { network: 'nile' });

    assert.equal(selection.name, 'tron');
    assert.equal(selection.network, 'nile');
    assert.equal(selection.reason, 'explicit-network');
  });

  it('rejects conflicting --network and --target values', () => {
    const config = normalizeSunhatConfig(dualTargetConfig(), validNetworks());
    assertConfigError(
      () =>
        resolveCompilationTargets(config, {
          network: 'nile',
          target: 'evm',
        }),
      'NETWORK_TARGET_MISMATCH'
    );
  });

  it('rejects --all combined with a target selector', () => {
    const config = normalizeSunhatConfig(dualTargetConfig());
    assertConfigError(
      () => resolveCompilationTargets(config, { all: true, target: 'evm' }),
      'TARGET_SELECTION_CONFLICT'
    );
  });

  it('returns every target for --all without merging them', () => {
    const config = normalizeSunhatConfig(dualTargetConfig());
    const selections = resolveCompilationTargets(config, { all: true });

    assert.deepEqual(
      selections.map(({ name }) => name),
      ['evm', 'tron']
    );
    assert.notEqual(selections[0].target, selections[1].target);
  });

  it('uses defaultTarget for a plain compile', () => {
    const config = normalizeSunhatConfig(dualTargetConfig());
    const [selection] = resolveCompilationTargets(config);

    assert.equal(selection.name, 'tron');
    assert.equal(selection.reason, 'default-target');
  });

  it('selects the only target when no default is configured', () => {
    const raw = singleEvmConfig();
    delete raw.compilation.defaultTarget;
    const [selection] = resolveCompilationTargets(normalizeSunhatConfig(raw));

    assert.equal(selection.name, 'evm');
    assert.equal(selection.reason, 'single-target');
  });

  it('rejects an ambiguous plain compile', () => {
    const raw = dualTargetConfig();
    delete raw.compilation.defaultTarget;
    assertConfigError(
      () => resolveCompilationTargets(normalizeSunhatConfig(raw)),
      'AMBIGUOUS_TARGET'
    );
  });
});

describe('Sunhat 2.x test target resolution', () => {
  it('uses sunhat.test.target when configured', () => {
    const raw = dualTargetConfig();
    raw.test = { target: 'evm' };
    const selection = resolveTestTarget(normalizeSunhatConfig(raw));

    assert.equal(selection.name, 'evm');
    assert.equal(selection.reason, 'test-target');
  });

  it('auto-selects the unique EVM target', () => {
    const selection = resolveTestTarget(normalizeSunhatConfig(dualTargetConfig()));

    assert.equal(selection.name, 'evm');
    assert.equal(selection.reason, 'unique-evm-target');
  });

  it('requires an explicit TVM network for TRON tests', () => {
    const config = normalizeSunhatConfig(dualTargetConfig(), validNetworks());
    assertConfigError(
      () => resolveTestTarget(config, { target: 'tron' }),
      'TRON_TEST_NETWORK_REQUIRED'
    );
  });

  it('accepts a TRON test target through an explicitly bound network', () => {
    const config = normalizeSunhatConfig(dualTargetConfig(), validNetworks());
    const selection = resolveTestTarget(config, { network: 'nile' });

    assert.equal(selection.name, 'tron');
    assert.equal(selection.network, 'nile');
  });
});

function singleEvmConfig(): MutableSunhatConfig {
  return {
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
              version: '0.8.25',
              settings: { optimizer: { enabled: true, runs: 200 } },
            },
          ],
        },
      },
    },
  };
}

function dualTargetConfig(): MutableSunhatConfig {
  const raw = singleEvmConfig();
  raw.compilation.defaultTarget = 'tron';
  raw.compilation.targets.tron = {
    chain: 'tron',
    sources: ['contracts/shared', 'contracts/tron'],
    compilers: [
      {
        id: 'tron-solidity',
        kind: 'tron-solc',
        version: '0.8.25',
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
      {
        id: 'tron-vyper',
        kind: 'vyper',
        version: '0.4.3',
        path: VYPER_PATH,
        sha256: SHA256,
        settings: { evmVersion: 'london', optimize: 'gas' },
      },
    ],
  };
  return raw;
}

function validNetworks(): Record<string, unknown> {
  return {
    hardhatMainnet: {
      type: 'edr-simulated',
      chainType: 'l1',
      sunhat: { target: 'evm' },
    },
    nile: {
      type: 'http',
      chainType: 'generic',
      sunhat: { target: 'tron', feeLimitSun: '15000000000' },
    },
  };
}

function assertConfigError(
  action: () => unknown,
  expectedCode: SunhatConfigError['code']
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof SunhatConfigError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}
