import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { errorMessage, hasErrorCode, toolchainError } from '../errors.js';
import { spawnNative } from '../process/spawn.js';
import { isRecord, readJson } from '../project/json.js';

interface PackageJson {
  version?: string;
  bin?: string | Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function runHardhat(
  root: string,
  args: readonly string[],
): Promise<number> {
  const project = readPackageJson(resolve(root, 'package.json'));
  const require = createRequire(resolve(root, 'package.json'));
  let manifestPath: string;
  try {
    manifestPath = require.resolve('hardhat/package.json');
  } catch (error) {
    // Node 20 may fail while parsing metadata before returning its resolved path.
    if (error instanceof SyntaxError || error instanceof TypeError) {
      const path =
        'path' in error && typeof error.path === 'string'
          ? error.path
          : require.resolve
              .paths('hardhat')
              ?.map((directory) => resolve(directory, 'hardhat/package.json'))
              .find((candidate) => existsSync(candidate));
      if (path) {
        readPackageJson(path);
      }
    }
    if (hasErrorCode(error, 'ERR_INVALID_PACKAGE_CONFIG')) {
      return toolchainError(
        `cannot resolve Hardhat in ${root}: ${errorMessage(error)}`,
        { cause: error },
      );
    }
    return toolchainError(
      'local Hardhat dependency is missing; install the project lockfile dependencies',
      { cause: error },
    );
  }
  const manifest = readPackageJson(manifestPath);
  if (!manifest.version?.startsWith('2.')) {
    return toolchainError(
      `Hardhat 2 is required; resolved ${manifest.version ?? 'unknown'} at ${manifestPath}`,
    );
  }
  const expected =
    project.devDependencies?.hardhat ?? project.dependencies?.hardhat;
  if (!expected) {
    return toolchainError(
      'Hardhat must be declared in the project package.json',
    );
  }
  if (expected !== manifest.version) {
    return toolchainError(
      `Hardhat version mismatch: expected ${expected}, resolved ${manifest.version} at ${manifestPath}`,
    );
  }
  const relative =
    typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.hardhat;
  if (!relative) {
    return toolchainError(
      `Hardhat package has no hardhat bin entry: ${manifestPath}`,
    );
  }
  if (isAbsolute(relative)) {
    return toolchainError('Hardhat bin must be package-relative');
  }
  const packageRoot = realpathSync(dirname(manifestPath));
  const entry = realpathSync(resolve(packageRoot, relative));
  if (entry !== packageRoot && !entry.startsWith(`${packageRoot}${sep}`)) {
    return toolchainError('Hardhat bin escapes package root');
  }
  return await spawnNative(process.execPath, [entry, ...args], root);
}

function readPackageJson(path: string): PackageJson {
  const value = readJson(path);
  if (
    !isRecord(value) ||
    (value.version !== undefined && typeof value.version !== 'string') ||
    (value.bin !== undefined &&
      typeof value.bin !== 'string' &&
      !isStringRecord(value.bin)) ||
    (value.dependencies !== undefined && !isStringRecord(value.dependencies)) ||
    (value.devDependencies !== undefined &&
      !isStringRecord(value.devDependencies))
  ) {
    return toolchainError(`invalid package manifest: ${path}`);
  }
  return value;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}
