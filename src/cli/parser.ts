import { usage } from '../errors.js';
import type { Target } from '../project/binding.js';
export type Invocation =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'init'; args: string[] }
  | { kind: 'run'; command: string; args: string[] };
export function parse(argv: readonly string[]): Invocation {
  if (
    argv.length === 0 ||
    (argv.length === 1 && (argv[0] === '-h' || argv[0] === '--help'))
  ) {
    return { kind: 'help' };
  }
  if (argv.length === 1 && (argv[0] === '-V' || argv[0] === '--version')) {
    return { kind: 'version' };
  }
  const command = argv[0];
  if (!command) {
    return usage('missing command or task');
  }
  if (command === 'init') {
    return { kind: 'init', args: argv.slice(1) };
  }
  if (command === 'hardhat' || command === 'foundry') {
    return usage(
      `framework namespace is no longer supported; run \`sunhat ${argv[1] ?? '<command>'}\` instead`,
    );
  }
  return { kind: 'run', command, args: argv.slice(1) };
}
export function parseTarget(value: string): Target {
  if (value !== 'tron' && value !== 'evm') {
    return usage(`invalid target ${value}; expected tron or evm`);
  }
  return value;
}
