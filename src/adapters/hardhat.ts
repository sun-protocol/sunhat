import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve } from 'node:path';
import { errorMessage, hasErrorCode, toolchainError } from '../errors.js';
import { spawnNative } from '../process.js';
import type { Target } from '../project/binding.js';
import {
  assertHardhatTarget,
  hardhatMajor,
  isHardhat3NodeSupported,
  readHardhatPackage,
} from '../project/hardhat.js';
import { resolveExecutable } from './executable.js';

export async function runHardhat(
  root: string,
  args: readonly string[],
  target: Target,
): Promise<number> {
  const projectPath = resolve(root, 'package.json');
  const project = readHardhatPackage(projectPath);
  const require = createRequire(projectPath);
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
        readHardhatPackage(path);
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
  const manifest = readHardhatPackage(manifestPath);
  const major = hardhatMajor(manifest.version);
  if (!major) {
    return toolchainError(
      `Hardhat 2 or 3 is required; resolved ${manifest.version ?? 'unknown'} at ${manifestPath}`,
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
  assertHardhatTarget(major, target);
  if (major === 3) {
    if (project.type !== 'module') {
      return toolchainError(
        `Hardhat 3 requires "type": "module" in ${projectPath}`,
      );
    }
    if (!isHardhat3NodeSupported(process.versions.node)) {
      return toolchainError(
        `Hardhat 3 requires Node.js 22.13+, 24.x or 26.x; resolved ${process.versions.node} for ${manifestPath}`,
      );
    }
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
  const entry = resolveExecutable(dirname(manifestPath), relative, 'Hardhat');
  return await spawnNative(process.execPath, [entry, ...args], root);
}
