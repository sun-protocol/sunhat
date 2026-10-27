import { resolve } from 'node:path';
import { toolchainError } from '../errors.js';
import type { Target } from '../project/binding.js';
import { isRecord, readJson } from '../project/json.js';

export type FoundryTool = 'forge' | 'cast' | 'anvil' | 'chisel';

export interface ToolchainLock {
  version: number;
  target: Target;
  source: string;
  release: string;
  revision: string;
  platform: string;
  binaries: Partial<Record<FoundryTool, { path: string }>>;
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
