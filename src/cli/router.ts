import { resolve } from 'node:path';
import { runHardhat } from '../adapters/hardhat.js';
import { runFoundry } from '../adapters/foundry.js';
import { initProject } from '../commands/init.js';
import { toolchain } from '../commands/toolchain.js';
import { usage } from '../errors.js';
import { readPackageMetadata } from '../package.js';
import { readBinding } from '../project/binding.js';
import { findProjectRoot } from '../project/root.js';
import type { Invocation } from './parser.js';

export const HELP = `Sunhat project-bound framework CLI

Usage:
  sunhat init [--framework <foundry|hardhat>] [--target <tron|evm>] [--adopt] [path]
  sunhat <command> [args...]

Init defaults: framework=foundry, target=tron
`;

export async function route(invocation: Invocation): Promise<number> {
  if (invocation.kind === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (invocation.kind === 'version') {
    process.stdout.write(`sunhat ${readPackageMetadata().version}\n`);
    return 0;
  }
  if (invocation.kind === 'init') {
    return initProject(invocation.args);
  }
  const root = findProjectRoot(process.cwd());
  const binding = readBinding(resolve(root, 'sunhat.toml'));
  if (binding.framework === 'hardhat') {
    return await runHardhat(root, [invocation.command, ...invocation.args]);
  }
  if (invocation.command === 'toolchain') {
    return toolchain(root, binding.target, invocation.args);
  }
  const command = invocation.command;
  if (command === 'anvil' || command === 'chisel') {
    if (binding.target === 'tron') {
      return usage(`${command} is unsupported for the TRON target`);
    }
    return await runFoundry(root, binding.target, command, invocation.args);
  }
  if (command === 'cast') {
    return await runFoundry(root, binding.target, 'cast', invocation.args);
  }
  return await runFoundry(root, binding.target, 'forge', [
    command,
    ...invocation.args,
  ]);
}
