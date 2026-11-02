import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConfigHooks } from 'hardhat/types/hooks';
import { isRecord } from '../../json.js';
import core from '../../../vendor/hardhat-tron/index.js';
import type { CompilerBatch, TreConfig } from './types.js';

export const TRE_IMAGE =
  'tronbox/tre@sha256:f4332e11df12a9f360639a4546fd046593909630fda48af00b30410c144342f0';
const MIRROR =
  'https://raw.githubusercontent.com/tronprotocol/solc-bin/32695fe4b8d85704da9ec4cedce107a905e412ac';
const SOLC_SHA256 =
  '31fe546b9e6ad74e816d6406dcdb59f3af180f9c1145fd994bd5205d9c8465c1';
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
      input.image === undefined ? TRE_IMAGE : string(input.image, 'tre.image'),
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
          ? MIRROR
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

export default async (): Promise<Partial<ConfigHooks>> => ({
  async resolveUserConfig(user, resolver, next) {
    const defaultNetwork = user.networks?.default;
    let tre = normalizeTre(
      user.tre,
      defaultNetwork?.type === 'http' && defaultNetwork.tron === true
        ? 'tron'
        : 'evm',
    );
    const resolved = await next(user, resolver);
    if (
      tre.compiler.batchesPath !== undefined &&
      tre.compiler.batches.length === 0
    ) {
      const module: unknown = await import(
        pathToFileURL(resolve(resolved.paths.root, tre.compiler.batchesPath))
          .href
      );
      if (!isRecord(module) || !Array.isArray(module.default)) {
        throw new Error('tre.compiler.batchesPath must export an array');
      }
      tre = normalizeTre({
        ...tre,
        compiler: { ...tre.compiler, batches: module.default },
      });
    }
    if (tre.jarPath !== undefined) {
      tre.jarPath = resolve(resolved.paths.root, tre.jarPath);
    }
    resolved.tre = tre;
    for (const [name, network] of Object.entries(user.networks ?? {})) {
      if (
        'tron' in network &&
        network.tron !== undefined &&
        typeof network.tron !== 'boolean'
      ) {
        throw new Error(`networks.${name}.tron must be a boolean`);
      }
      if ('tron' in network && network.tron === true) {
        const target = resolved.networks[name];
        if (!target || target.type !== 'http') {
          throw new Error(`TRON network ${name} must use type http`);
        }
        target.tron = true;
      }
    }
    const evmArtifacts = resolved.paths.artifacts;
    tre.artifactPaths = {
      evm: evmArtifacts,
      tron: evmArtifacts + '-tron',
    };
    if (tre.compiler.target === 'evm') {
      return resolved;
    }
    resolved.paths.artifacts = tre.artifactPaths.tron;
    if (!resolved.paths.cache.endsWith('-tron')) {
      resolved.paths.cache += '-tron';
    }
    const compiler = core.createCompiler(
      tre.compiler.cacheDir === undefined
        ? {}
        : { cacheDir: resolve(resolved.paths.root, tre.compiler.cacheDir) },
    );
    for (const profile of Object.values(resolved.solidity.profiles)) {
      for (const entry of [
        ...profile.compilers,
        ...Object.values(profile.overrides),
      ]) {
        if (entry.type !== undefined && entry.type !== 'solc') {
          throw new Error('TRON requires a solc compiler');
        }
        if (tre.compiler.path) {
          if (entry.version !== '0.8.26') {
            throw new Error(
              'The pinned local TRON compiler requires Solidity 0.8.26',
            );
          }
          const path = resolve(resolved.paths.root, tre.compiler.path);
          if (
            createHash('sha256')
              .update(await readFile(path))
              .digest('hex') !== SOLC_SHA256
          ) {
            throw new Error(`TRON compiler checksum mismatch: ${path}`);
          }
          entry.path = path;
        } else {
          entry.path = (
            await compiler.getCompiler(entry.version, {
              mirror: tre.compiler.mirror,
            })
          ).compilerPath;
        }
        entry.preferWasm = true;
      }
    }
    return resolved;
  },
});
