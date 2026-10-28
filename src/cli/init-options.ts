import { parseArgs } from 'node:util';
import { CliError, errorMessage, usage } from '../errors.js';
import type { Framework, Target } from '../project/binding.js';
import { parseTarget } from './parser.js';

export interface InitOptions {
  framework: Framework;
  target: Target;
  path: string;
  adopt: boolean;
}

export function parseInitOptions(
  argv: readonly string[],
): InitOptions | undefined {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: {
        framework: { type: 'string', default: 'foundry' },
        target: { type: 'string', default: 'tron' },
        adopt: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) {
      return undefined;
    }
    if (positionals.length > 1) {
      return usage('init accepts at most one path');
    }
    const framework = values.framework;
    if (framework !== 'foundry' && framework !== 'hardhat') {
      return usage('--framework requires foundry or hardhat');
    }
    return {
      framework,
      target: parseTarget(values.target),
      path: positionals[0] ?? '.',
      adopt: values.adopt,
    };
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    return usage(errorMessage(error), { cause: error });
  }
}
