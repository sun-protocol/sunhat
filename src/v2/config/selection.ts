import { SunhatConfigError } from './errors.js';
import type { SunhatConfigErrorCode } from './errors.js';
import type {
  NormalizedSunhatConfig,
  ResolvedTarget,
  TargetSelectionReason,
} from './types.js';

export interface CompilationSelectionOptions {
  readonly all?: boolean;
  readonly network?: string;
  readonly target?: string;
}

export interface TestSelectionOptions {
  readonly network?: string;
  readonly target?: string;
}

export function resolveCompilationTargets(
  config: NormalizedSunhatConfig,
  options: CompilationSelectionOptions = {}
): readonly ResolvedTarget[] {
  if (options.all === true) {
    if (options.network !== undefined || options.target !== undefined) {
      fail(
        'TARGET_SELECTION_CONFLICT',
        'cli',
        '--all cannot be combined with --network or --target'
      );
    }
    return Object.freeze(
      Object.entries(config.compilation.targets).map(([name, target]) =>
        Object.freeze({ name, target, reason: 'all' as const })
      )
    );
  }

  const explicitNetwork = resolveNetwork(config, options.network);
  if (explicitNetwork !== undefined && explicitNetwork.target === undefined) {
    fail(
      'INVALID_NETWORK_BINDING',
      `networks.${explicitNetwork.name}.sunhat.target`,
      'selected network does not declare a Sunhat target'
    );
  }
  if (
    explicitNetwork?.target !== undefined &&
    options.target !== undefined &&
    explicitNetwork.target !== options.target
  ) {
    fail(
      'NETWORK_TARGET_MISMATCH',
      'cli',
      `network "${explicitNetwork.name}" binds target "${explicitNetwork.target}", not "${options.target}"`
    );
  }

  if (options.target !== undefined) {
    return Object.freeze([
      resolveTarget(
        config,
        options.target,
        explicitNetwork?.name,
        'explicit-target'
      ),
    ]);
  }
  if (explicitNetwork?.target !== undefined) {
    return Object.freeze([
      resolveTarget(
        config,
        explicitNetwork.target,
        explicitNetwork.name,
        'explicit-network'
      ),
    ]);
  }
  if (config.compilation.defaultTarget !== undefined) {
    return Object.freeze([
      resolveTarget(
        config,
        config.compilation.defaultTarget,
        undefined,
        'default-target'
      ),
    ]);
  }

  const targetNames = Object.keys(config.compilation.targets);
  if (targetNames.length === 1) {
    return Object.freeze([
      resolveTarget(config, targetNames[0], undefined, 'single-target'),
    ]);
  }
  fail(
    'AMBIGUOUS_TARGET',
    'sunhat.compilation.defaultTarget',
    'multiple targets exist; configure defaultTarget or pass --target/--network/--all'
  );
}

export function resolveTestTarget(
  config: NormalizedSunhatConfig,
  options: TestSelectionOptions = {}
): ResolvedTarget {
  const explicitNetwork = resolveNetwork(config, options.network);
  if (explicitNetwork !== undefined && explicitNetwork.target === undefined) {
    fail(
      'INVALID_NETWORK_BINDING',
      `networks.${explicitNetwork.name}.sunhat.target`,
      'selected network does not declare a Sunhat target'
    );
  }
  if (
    explicitNetwork?.target !== undefined &&
    options.target !== undefined &&
    explicitNetwork.target !== options.target
  ) {
    fail(
      'NETWORK_TARGET_MISMATCH',
      'cli',
      `network "${explicitNetwork.name}" binds target "${explicitNetwork.target}", not "${options.target}"`
    );
  }

  let selected: ResolvedTarget;
  if (options.target !== undefined) {
    selected = resolveTarget(
      config,
      options.target,
      explicitNetwork?.name,
      'explicit-target'
    );
  } else if (explicitNetwork?.target !== undefined) {
    selected = resolveTarget(
      config,
      explicitNetwork.target,
      explicitNetwork.name,
      'explicit-network'
    );
  } else if (config.test.target !== undefined) {
    selected = resolveTarget(config, config.test.target, undefined, 'test-target');
  } else {
    const evmTargets = Object.entries(config.compilation.targets).filter(
      ([, target]) => target.chain === 'evm'
    );
    if (evmTargets.length !== 1) {
      fail(
        'AMBIGUOUS_TARGET',
        'sunhat.test.target',
        'test target is ambiguous; configure sunhat.test.target or pass --target/--network'
      );
    }
    selected = resolveTarget(
      config,
      evmTargets[0][0],
      undefined,
      'unique-evm-target'
    );
  }

  if (selected.target.chain === 'tron' && selected.network === undefined) {
    fail(
      'TRON_TEST_NETWORK_REQUIRED',
      'cli.network',
      'TRON tests require an explicitly selected TVM network'
    );
  }
  return selected;
}

function resolveNetwork(
  config: NormalizedSunhatConfig,
  networkName: string | undefined
) {
  if (networkName === undefined) {
    return undefined;
  }
  const network = config.networks[networkName];
  if (network === undefined) {
    fail('INVALID_NETWORK_BINDING', 'cli.network', `network "${networkName}" is not defined`);
  }
  return network;
}

function resolveTarget(
  config: NormalizedSunhatConfig,
  targetName: string,
  network: string | undefined,
  reason: TargetSelectionReason
): ResolvedTarget {
  const target = config.compilation.targets[targetName];
  if (target === undefined) {
    fail('TARGET_NOT_FOUND', 'cli.target', `target "${targetName}" is not defined`);
  }
  return Object.freeze({ name: targetName, network, reason, target });
}

function fail(
  code: SunhatConfigErrorCode,
  configPath: string,
  message: string
): never {
  throw new SunhatConfigError(code, configPath, message);
}
