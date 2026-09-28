import path from 'path';
import { SunhatConfigError } from './errors.js';
import type { SunhatConfigErrorCode } from './errors.js';
import type {
  ChainKind,
  CompilerKind,
  JsonValue,
  NormalizedCompilationTarget,
  NormalizedCompilerConfig,
  NormalizedNetworkBinding,
  NormalizedSunhatConfig,
  VerificationSourceMode,
} from './types.js';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const FORBIDDEN_OBJECT_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

export function normalizeSunhatConfig(
  rawSunhat: unknown,
  rawNetworks: unknown = {}
): NormalizedSunhatConfig {
  const sunhat = readObject(rawSunhat, 'sunhat');
  assertKnownKeys(sunhat, ['compilation', 'test', 'verification'], 'sunhat');

  const compilation = readObject(sunhat.compilation ?? {}, 'sunhat.compilation');
  assertKnownKeys(
    compilation,
    ['defaultTarget', 'targets'],
    'sunhat.compilation'
  );
  const targetsObject = readObject(
    compilation.targets ?? {},
    'sunhat.compilation.targets'
  );
  const targetNames = Object.keys(targetsObject);
  if (targetNames.length === 0) {
    fail(
      'EMPTY_TARGETS',
      'sunhat.compilation.targets',
      'at least one target is required'
    );
  }

  const targets: Record<string, NormalizedCompilationTarget> = Object.create(null);
  for (const targetName of targetNames) {
    validateIdentifier(targetName, `sunhat.compilation.targets.${targetName}`);
    targets[targetName] = normalizeTarget(
      targetsObject[targetName],
      `sunhat.compilation.targets.${targetName}`
    );
  }

  const defaultTarget = readOptionalString(
    compilation.defaultTarget,
    'sunhat.compilation.defaultTarget'
  );
  if (defaultTarget !== undefined && targets[defaultTarget] === undefined) {
    fail(
      'TARGET_NOT_FOUND',
      'sunhat.compilation.defaultTarget',
      `target "${defaultTarget}" is not defined`
    );
  }

  const test = readObject(sunhat.test ?? {}, 'sunhat.test');
  assertKnownKeys(test, ['target'], 'sunhat.test');
  const testTarget = readOptionalString(test.target, 'sunhat.test.target');
  if (testTarget !== undefined && targets[testTarget] === undefined) {
    fail(
      'TARGET_NOT_FOUND',
      'sunhat.test.target',
      `target "${testTarget}" is not defined`
    );
  }

  const verification = readObject(
    sunhat.verification ?? {},
    'sunhat.verification'
  );
  assertKnownKeys(
    verification,
    ['outputDir', 'sourceMode', 'autoExport'],
    'sunhat.verification'
  );
  const outputDir = normalizeProjectPath(
    readOptionalString(
      verification.outputDir,
      'sunhat.verification.outputDir'
    ) ?? 'verification',
    'sunhat.verification.outputDir'
  );
  const sourceMode = normalizeSourceMode(verification.sourceMode);
  const autoExport = readOptionalBoolean(
    verification.autoExport,
    'sunhat.verification.autoExport'
  ) ?? true;
  const networks = normalizeNetworks(rawNetworks, targets);

  return Object.freeze({
    compilation: Object.freeze({
      defaultTarget,
      targets: Object.freeze(targets),
    }),
    test: Object.freeze({ target: testTarget }),
    verification: Object.freeze({ autoExport, outputDir, sourceMode }),
    networks: Object.freeze(networks),
  });
}

function normalizeTarget(rawTarget: unknown, configPath: string): NormalizedCompilationTarget {
  const target = readObject(rawTarget, configPath);
  assertKnownKeys(target, ['chain', 'sources', 'compilers', 'overrides'], configPath);
  const chain = readEnum(target.chain, ['evm', 'tron'], `${configPath}.chain`);
  const sources = readArray(target.sources, `${configPath}.sources`).map(
    (source, index) =>
      normalizeProjectPath(
        readString(source, `${configPath}.sources[${index}]`),
        `${configPath}.sources[${index}]`
      )
  );
  if (sources.length === 0) {
    fail('INVALID_CONFIG', `${configPath}.sources`, 'at least one source path is required');
  }
  assertUnique(sources, `${configPath}.sources`, 'source path');

  const rawCompilers = readArray(target.compilers, `${configPath}.compilers`);
  if (rawCompilers.length === 0) {
    fail('INVALID_CONFIG', `${configPath}.compilers`, 'at least one compiler is required');
  }
  const compilerIds = new Set<string>();
  const compilerCoordinates = new Set<string>();
  const compilers = rawCompilers.map((compiler, index) => {
    const normalized = normalizeCompiler(
      compiler,
      `${configPath}.compilers[${index}]`
    );
    if (compilerIds.has(normalized.id)) {
      fail(
        'DUPLICATE_COMPILER',
        `${configPath}.compilers[${index}].id`,
        `compiler id "${normalized.id}" is duplicated`
      );
    }
    compilerIds.add(normalized.id);
    const coordinate = `${normalized.kind}@${normalized.version}`;
    if (compilerCoordinates.has(coordinate)) {
      fail(
        'DUPLICATE_COMPILER',
        `${configPath}.compilers[${index}]`,
        `compiler ${coordinate} is ambiguous; use one id and override source paths`
      );
    }
    compilerCoordinates.add(coordinate);
    validateCompilerChain(
      chain,
      normalized.kind,
      `${configPath}.compilers[${index}].kind`
    );
    return normalized;
  });

  const rawOverrides = readObject(target.overrides ?? {}, `${configPath}.overrides`);
  const overrides: Record<string, string> = Object.create(null);
  for (const [sourcePath, compilerIdValue] of Object.entries(rawOverrides)) {
    const normalizedSourcePath = normalizeProjectPath(
      sourcePath,
      `${configPath}.overrides.${sourcePath}`
    );
    const compilerId = readString(
      compilerIdValue,
      `${configPath}.overrides.${sourcePath}`
    );
    if (!compilerIds.has(compilerId)) {
      fail(
        'INVALID_CONFIG',
        `${configPath}.overrides.${sourcePath}`,
        `compiler id "${compilerId}" is not defined in this target`
      );
    }
    overrides[normalizedSourcePath] = compilerId;
  }

  return Object.freeze({
    chain,
    sources: Object.freeze(sources),
    compilers: Object.freeze(compilers),
    overrides: Object.freeze(overrides),
  });
}

function normalizeCompiler(
  rawCompiler: unknown,
  configPath: string
): NormalizedCompilerConfig {
  const compiler = readObject(rawCompiler, configPath);
  assertKnownKeys(
    compiler,
    ['id', 'kind', 'version', 'path', 'sha256', 'settings'],
    configPath
  );
  const id = readString(compiler.id, `${configPath}.id`);
  validateIdentifier(id, `${configPath}.id`);
  const kind = readEnum(
    compiler.kind,
    ['solc', 'tron-solc', 'vyper'],
    `${configPath}.kind`
  );
  const version = readString(compiler.version, `${configPath}.version`);
  if (!EXACT_VERSION_PATTERN.test(version)) {
    fail(
      'INVALID_VERSION',
      `${configPath}.version`,
      `"${version}" is not an exact compiler version`
    );
  }

  const compilerPath = readOptionalString(compiler.path, `${configPath}.path`);
  const sha256 = readOptionalString(compiler.sha256, `${configPath}.sha256`);
  if ((compilerPath === undefined) !== (sha256 === undefined)) {
    fail(
      'MISSING_COMPILER_INTEGRITY',
      configPath,
      'custom compiler path and sha256 must be configured together'
    );
  }
  if (kind === 'vyper' && compilerPath === undefined) {
    fail(
      'MISSING_COMPILER_INTEGRITY',
      configPath,
      'Vyper requires an absolute vyper-json path and sha256'
    );
  }
  if (compilerPath !== undefined && !path.isAbsolute(compilerPath)) {
    fail('INVALID_PATH', `${configPath}.path`, 'compiler path must be absolute');
  }
  if (sha256 !== undefined && !SHA256_PATTERN.test(sha256)) {
    fail(
      'INVALID_CONFIG',
      `${configPath}.sha256`,
      'sha256 must contain 64 hex characters'
    );
  }

  const settings = cloneJsonValue(compiler.settings ?? {}, `${configPath}.settings`);
  return Object.freeze({
    id,
    kind,
    version,
    path: compilerPath,
    sha256: sha256?.toLowerCase(),
    settings,
  });
}

function normalizeNetworks(
  rawNetworks: unknown,
  targets: Readonly<Record<string, NormalizedCompilationTarget>>
): Record<string, NormalizedNetworkBinding> {
  const networksObject = readObject(rawNetworks, 'networks');
  const networks: Record<string, NormalizedNetworkBinding> = Object.create(null);
  for (const [networkName, rawNetwork] of Object.entries(networksObject)) {
    validateIdentifier(networkName, `networks.${networkName}`);
    const network = readObject(rawNetwork, `networks.${networkName}`);
    const sunhat = readObject(network.sunhat ?? {}, `networks.${networkName}.sunhat`);
    const targetName = readOptionalString(
      sunhat.target,
      `networks.${networkName}.sunhat.target`
    );
    const type = readOptionalString(network.type, `networks.${networkName}.type`);
    const chainType = readOptionalString(
      network.chainType,
      `networks.${networkName}.chainType`
    );
    if (targetName !== undefined) {
      const target = targets[targetName];
      if (target === undefined) {
        fail(
          'TARGET_NOT_FOUND',
          `networks.${networkName}.sunhat.target`,
          `target "${targetName}" is not defined`
        );
      }
      if (
        target.chain === 'tron' &&
        (type === 'edr-simulated' || chainType === 'l1' || chainType === 'op')
      ) {
        fail(
          'INVALID_NETWORK_BINDING',
          `networks.${networkName}`,
          'TRON targets cannot use an EDR-simulated, l1, or op network'
        );
      }
    }
    networks[networkName] = Object.freeze({
      name: networkName,
      type,
      chainType,
      target: targetName,
    });
  }
  return networks;
}

function validateCompilerChain(
  chain: ChainKind,
  compiler: CompilerKind,
  configPath: string
): void {
  if (
    (chain === 'evm' && compiler === 'tron-solc') ||
    (chain === 'tron' && compiler === 'solc')
  ) {
    fail(
      'COMPILER_CHAIN_MISMATCH',
      configPath,
      `compiler "${compiler}" cannot build target chain "${chain}"`
    );
  }
}

function normalizeSourceMode(value: unknown): VerificationSourceMode {
  if (value === undefined) {
    return 'multi-file';
  }
  return readEnum(
    value,
    ['multi-file', 'flatten', 'both'],
    'sunhat.verification.sourceMode'
  );
}

function normalizeProjectPath(value: string, configPath: string): string {
  if (value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    fail('INVALID_PATH', configPath, 'path must stay inside the project');
  }
  const normalized = path.posix.normalize(value.replace(/\\/g, '/')).replace(/^\.\//, '');
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  ) {
    fail('INVALID_PATH', configPath, 'path must stay inside the project');
  }
  return normalized.replace(/\/$/, '');
}

function cloneJsonValue(value: unknown, configPath: string): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('INVALID_CONFIG', configPath, 'number must be finite');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((entry, index) => cloneJsonValue(entry, `${configPath}[${index}]`))
    );
  }
  const object = readObject(value, configPath);
  const clone: Record<string, JsonValue> = Object.create(null);
  for (const [key, entry] of Object.entries(object)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      fail('INVALID_CONFIG', `${configPath}.${key}`, 'unsafe object key');
    }
    clone[key] = cloneJsonValue(entry, `${configPath}.${key}`);
  }
  return Object.freeze(clone);
}

function assertKnownKeys(
  object: Record<string, unknown>,
  knownKeys: readonly string[],
  configPath: string
): void {
  const known = new Set(knownKeys);
  for (const key of Object.keys(object)) {
    if (!known.has(key)) {
      fail('INVALID_CONFIG', `${configPath}.${key}`, 'unknown configuration field');
    }
  }
}

function assertUnique(values: readonly string[], configPath: string, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      fail('INVALID_CONFIG', configPath, `${label} "${value}" is duplicated`);
    }
    seen.add(value);
  }
}

function validateIdentifier(value: string, configPath: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    fail('INVALID_CONFIG', configPath, `"${value}" is not a valid identifier`);
  }
}

function readObject(value: unknown, configPath: string): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail('INVALID_CONFIG', configPath, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function readArray(value: unknown, configPath: string): unknown[] {
  if (!Array.isArray(value)) {
    fail('INVALID_CONFIG', configPath, 'expected an array');
  }
  return value;
}

function readString(value: unknown, configPath: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('INVALID_CONFIG', configPath, 'expected a non-empty string');
  }
  return value;
}

function readOptionalString(value: unknown, configPath: string): string | undefined {
  return value === undefined ? undefined : readString(value, configPath);
}

function readOptionalBoolean(value: unknown, configPath: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    fail('INVALID_CONFIG', configPath, 'expected a boolean');
  }
  return value;
}

function readEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  configPath: string
): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    fail('INVALID_CONFIG', configPath, `expected one of: ${values.join(', ')}`);
  }
  return value as T;
}

function fail(
  code: SunhatConfigErrorCode,
  configPath: string,
  message: string
): never {
  throw new SunhatConfigError(code, configPath, message);
}
