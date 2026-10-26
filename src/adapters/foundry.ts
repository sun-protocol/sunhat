import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { toolchainError } from '../errors.js';
import type { Target } from '../project/binding.js';
import { spawnNative } from '../process/spawn.js';
import { releaseFor } from '../toolchain/releases.js';

type FoundryTool = 'forge' | 'cast' | 'anvil' | 'chisel';
interface BinaryLock { path: string; sha256: string }
export interface ToolchainLock {
  version: number;
  target: Target;
  source: string;
  release: string;
  revision: string;
  platform: string;
  binaries: Record<FoundryTool, BinaryLock>;
}

export async function runFoundry(root: string, target: Target, tool: FoundryTool, args: readonly string[]): Promise<number> {
  const lock = loadToolchain(root, target); const binary = lock.binaries[tool];
  if (!binary) return toolchainError(`locked toolchain does not provide ${tool}`);
  const projectRoot = realpathSync(root); const executable = realpathSync(resolve(projectRoot, binary.path));
  if (executable !== projectRoot && !executable.startsWith(`${projectRoot}${sep}`)) return toolchainError(`${tool} path escapes the project root`);
  const digest = sha256(executable); if (digest !== binary.sha256) return toolchainError(`${tool} digest mismatch: expected ${binary.sha256}, got ${digest}`);
  return await spawnNative(executable, args, root);
}

export function loadToolchain(root: string, target: Target): ToolchainLock {
  const path = resolve(root, '.sunhat/toolchain.json'); let lock: ToolchainLock;
  try { lock = JSON.parse(readFileSync(path, 'utf8')) as ToolchainLock; }
  catch { return toolchainError('Foundry toolchain is not installed; run `sunhat toolchain install`'); }
  const release = releaseFor(target);
  if (lock.version !== 1 || lock.target !== target || lock.source !== release.source || lock.release !== release.release || lock.revision !== release.revision) return toolchainError(`toolchain lock does not match ${release.source}@${release.revision}; reinstall it`);
  return lock;
}

export function sha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
