import { usage } from '../errors.js';
import type { Target } from '../project/binding.js';
import { installFoundry } from '../toolchain/install.js';
import { loadToolchain } from '../toolchain/lock.js';

export async function toolchain(
  root: string,
  target: Target,
  args: readonly string[],
): Promise<number> {
  const command = args[0];
  if (!command || args.length !== 1 || !['install', 'info'].includes(command)) {
    return usage('toolchain requires exactly one command: install or info');
  }
  if (command === 'install') {
    return await installFoundry(root, target);
  }
  const lock = loadToolchain(root, target);
  process.stdout.write(
    `framework=foundry\ntarget=${target}\nsource=${lock.source}\nrelease=${lock.release}\nrevision=${lock.revision}\nplatform=${lock.platform}\n`,
  );
  return 0;
}
