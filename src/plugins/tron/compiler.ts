import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getCacheDir } from '@nomicfoundation/hardhat-utils/global-dir';
import type { HardhatConfig } from 'hardhat/types/config';
import core from '../../../vendor/hardhat-tron/index.js';
import type { TreConfig } from './types.js';
import { tronDefaults } from './defaults.js';

export async function configureTronCompiler(
  config: HardhatConfig,
  tre: TreConfig,
): Promise<void> {
  const evmArtifacts = config.paths.artifacts;
  tre.artifactPaths = {
    evm: evmArtifacts,
    tron: evmArtifacts + '-tron',
  };
  if (tre.compiler.target === 'evm') {
    return;
  }
  config.paths.artifacts = tre.artifactPaths.tron;
  if (!config.paths.cache.endsWith('-tron')) {
    config.paths.cache += '-tron';
  }
  const compiler = tre.compiler.path
    ? undefined
    : core.createCompiler({
        cacheDir:
          tre.compiler.cacheDir === undefined
            ? join(await getCacheDir(), 'compilers-v3', 'wasm', 'tron-solc')
            : resolve(config.paths.root, tre.compiler.cacheDir),
      });
  for (const profile of Object.values(config.solidity.profiles)) {
    for (const entry of [
      ...profile.compilers,
      ...Object.values(profile.overrides),
    ]) {
      if (entry.type !== undefined && entry.type !== 'solc') {
        throw new Error('TRON requires a solc compiler');
      }
      if (tre.compiler.path) {
        if (entry.version !== tronDefaults.localCompiler.version) {
          throw new Error(
            `The pinned local TRON compiler requires Solidity ${tronDefaults.localCompiler.version}`,
          );
        }
        const path = resolve(config.paths.root, tre.compiler.path);
        if (
          createHash('sha256')
            .update(await readFile(path))
            .digest('hex') !== tronDefaults.localCompiler.sha256
        ) {
          throw new Error(`TRON compiler checksum mismatch: ${path}`);
        }
        entry.path = path;
      } else if (compiler !== undefined) {
        entry.path = (
          await compiler.getCompiler(entry.version, {
            mirror: tre.compiler.mirror,
          })
        ).compilerPath;
      }
      entry.preferWasm = true;
    }
  }
}
