import { toolchainError } from '../errors.js';
import type { Target } from '../project/binding.js';
import { spawnNative } from '../process.js';
import { loadToolchain } from '../toolchain/lock.js';
import type { FoundryTool } from '../toolchain/lock.js';
import { resolveExecutable } from './executable.js';

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
  const executable = resolveExecutable(root, binary.path, tool);
  return await spawnNative(executable, args, root);
}
