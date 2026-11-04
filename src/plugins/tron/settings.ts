import { isRecord } from '../../json.js';
import type { CompilerBatch, TreConfig } from './types.js';
import { tronDefaults } from './defaults.js';
import { normalizeFeePolicy } from '../../../vendor/hardhat-tron/runtime/fees.js';

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}
function boolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}
function integer(
  value: unknown,
  field: string,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new Error(`${field} must be an integer between 1 and ${maximum}`);
  }
  return value;
}
function strings(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string' && item.length > 0)
  ) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return value;
}
export function normalizeTre(
  value: unknown,
  defaultTarget: 'tron' | 'evm' = 'tron',
): TreConfig {
  if (value !== undefined && !isRecord(value)) {
    throw new Error('tre must be an object');
  }
  const input = value ?? {};
  const compiler = input.compiler === undefined ? {} : input.compiler;
  if (!isRecord(compiler)) {
    throw new Error('tre.compiler must be an object');
  }
  const startupEnv = input.startupEnv === undefined ? {} : input.startupEnv;
  if (
    !isRecord(startupEnv) ||
    !Object.values(startupEnv).every((item) => typeof item === 'string')
  ) {
    throw new Error('tre.startupEnv must contain string values');
  }
  const environment: Record<string, string> = {};
  for (const [key, entry] of Object.entries(startupEnv)) {
    environment[key] = string(entry, `tre.startupEnv.${key}`);
  }
  const batches: CompilerBatch[] = [];
  if (compiler.batches !== undefined) {
    if (!Array.isArray(compiler.batches)) {
      throw new Error('tre.compiler.batches must be an array');
    }
    for (const batch of compiler.batches) {
      if (!isRecord(batch)) {
        throw new Error('Compiler batches must be objects');
      }
      batches.push({
        name: string(batch.name, 'batch.name'),
        include: strings(batch.include, 'batch.include'),
        dirs: strings(batch.dirs, 'batch.dirs'),
        extraLeaves: strings(batch.extraLeaves, 'batch.extraLeaves'),
      });
    }
  }
  const requested =
    compiler.target === 'auto' || compiler.target === undefined
      ? defaultTarget
      : compiler.target;
  if (requested !== 'tron' && requested !== 'evm') {
    throw new Error('tre.compiler.target must be auto, tron or evm');
  }
  const target = boolean(compiler.enabled, 'tre.compiler.enabled', true)
    ? requested
    : 'evm';
  return {
    transaction: normalizeFeePolicy(input.transaction),
    autoStart: boolean(input.autoStart, 'tre.autoStart', false),
    autoStartOnTest: boolean(
      input.autoStartOnTest,
      'tre.autoStartOnTest',
      true,
    ),
    autoStartOnCompile: boolean(
      input.autoStartOnCompile,
      'tre.autoStartOnCompile',
      false,
    ),
    autoStartOnNode: boolean(
      input.autoStartOnNode,
      'tre.autoStartOnNode',
      true,
    ),
    keepRunning: boolean(input.keepRunning, 'tre.keepRunning', false),
    fundSigners: boolean(input.fundSigners, 'tre.fundSigners', false),
    matchers: boolean(input.matchers, 'tre.matchers', false),
    image:
      input.image === undefined
        ? tronDefaults.image
        : string(input.image, 'tre.image'),
    readinessTimeoutMs: integer(
      input.readinessTimeoutMs,
      'tre.readinessTimeoutMs',
      90000,
      600000,
    ),
    startupEnv: environment,
    ...(input.port === undefined
      ? {}
      : { port: integer(input.port, 'tre.port', 9090, 65535) }),
    ...(input.jarPath === undefined
      ? {}
      : { jarPath: string(input.jarPath, 'tre.jarPath') }),
    ...(input.containerName === undefined
      ? {}
      : { containerName: string(input.containerName, 'tre.containerName') }),
    compiler: {
      target,
      mirror:
        compiler.mirror === undefined
          ? tronDefaults.compilerMirror
          : string(compiler.mirror, 'tre.compiler.mirror'),
      include: strings(compiler.include, 'tre.compiler.include'),
      exclude: strings(compiler.exclude, 'tre.compiler.exclude'),
      batches,
      ...(compiler.batchesPath === undefined
        ? {}
        : {
            batchesPath: string(
              compiler.batchesPath,
              'tre.compiler.batchesPath',
            ),
          }),
      ...(compiler.path === undefined
        ? {}
        : { path: string(compiler.path, 'tre.compiler.path') }),
      ...(compiler.cacheDir === undefined
        ? {}
        : { cacheDir: string(compiler.cacheDir, 'tre.compiler.cacheDir') }),
    },
  };
}
