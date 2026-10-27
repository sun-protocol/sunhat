import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { toolchainError } from '../errors.js';
import type { Target } from '../project/binding.js';
import { spawnNative } from '../process/spawn.js';

type FoundryTool = 'forge' | 'cast' | 'anvil' | 'chisel';
export interface ToolchainLock {
  version: number;
  target: Target;
  source: string;
  release: string;
  revision: string;
  platform: string;
  binaries: Record<FoundryTool, { path: string }>;
}

export async function runFoundry(
  root: string,
  target: Target,
  tool: FoundryTool,
  args: readonly string[],
): Promise<number> {
  const lock = loadToolchain(root, target);
  const binary = lock.binaries[tool];
  if (!binary) {
    return toolchainError(`locked toolchain does not provide ${tool}`);
  }
  const projectRoot = realpathSync(root);
  const executable = realpathSync(resolve(projectRoot, binary.path));
  if (
    executable !== projectRoot &&
    !executable.startsWith(`${projectRoot}${sep}`)
  ) {
    return toolchainError(`${tool} path escapes the project root`);
  }
  return await spawnNative(executable, args, root);
}

export function loadToolchain(root: string, target: Target): ToolchainLock {
  const path = resolve(root, '.sunhat/toolchain.json');
  let lock: ToolchainLock;
  try {
    lock = JSON.parse(readFileSync(path, 'utf8')) as ToolchainLock;
  } catch {
    return toolchainError(
      'Foundry toolchain is not installed; run `sunhat toolchain install`',
    );
  }
  if ((lock.version !== 1 && lock.version !== 2) || lock.target !== target) {
    return toolchainError(
      `toolchain lock does not match the ${target} project; reinstall it`,
    );
  }
  return lock;
}
