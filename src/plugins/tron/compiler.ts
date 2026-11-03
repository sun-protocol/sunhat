import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { HardhatConfig } from 'hardhat/types/config';
import core from '../../../vendor/hardhat-tron/index.js';
import type { TreConfig } from './types.js';

const SOLC_SHA256 =
  '31fe546b9e6ad74e816d6406dcdb59f3af180f9c1145fd994bd5205d9c8465c1';

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
  const compiler = core.createCompiler(
    tre.compiler.cacheDir === undefined
      ? {}
      : { cacheDir: resolve(config.paths.root, tre.compiler.cacheDir) },
  );
  for (const profile of Object.values(config.solidity.profiles)) {
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
        const path = resolve(config.paths.root, tre.compiler.path);
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
}
