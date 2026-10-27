import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { toolchainError } from '../errors.js';
import type { Target } from '../project/binding.js';
import { spawnNative } from '../process/spawn.js';
import { isRecord, readJson } from '../project/json.js';

type FoundryTool = 'forge' | 'cast' | 'anvil' | 'chisel';
export interface ToolchainLock {
  version: number;
  target: Target;
  source: string;
  release: string;
  revision: string;
  platform: string;
  binaries: Partial<Record<FoundryTool, { path: string }>>;
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
  const lock = readJson(
    path,
    'Foundry toolchain is not installed; run `sunhat toolchain install`',
  );
  if (!isToolchainLock(lock)) {
    return toolchainError(`invalid Foundry toolchain lock: ${path}`);
  }
  if (lock.target !== target) {
    return toolchainError(
      `toolchain lock ${path} does not match the ${target} project; reinstall it`,
    );
  }
  return lock;
}

function isToolchainLock(value: unknown): value is ToolchainLock {
  return (
    isRecord(value) &&
    (value.version === 1 || value.version === 2) &&
    (value.target === 'evm' || value.target === 'tron') &&
    ['source', 'release', 'revision', 'platform'].every(
      (key) => typeof value[key] === 'string',
    ) &&
    isRecord(value.binaries) &&
    Object.values(value.binaries).every(
      (binary) =>
        isRecord(binary) &&
        typeof binary.path === 'string' &&
        binary.path.length > 0,
    )
  );
}
