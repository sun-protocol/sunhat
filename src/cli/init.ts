import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CliError, errorMessage, usage } from '../errors.js';
import type { Framework, Target } from '../project/binding.js';
import { applyScaffold } from '../scaffold/apply.js';
import { planAdoption, planScaffold } from '../scaffold/plan.js';
import { parseTarget } from './parser.js';

interface InitOptions {
  framework: Framework;
  target: Target;
  path: string;
  adopt: boolean;
}

export async function initProject(argv: readonly string[]): Promise<number> {
  const options = parseInitOptions(argv);
  if (!options) {
    process.stdout.write(
      'Usage: sunhat init [--framework <foundry|hardhat>] [--target <tron|evm>] [--adopt] [path]\nDefaults: framework=foundry, target=tron\nCreates project files only; install framework dependencies separately.\n',
    );
    return 0;
  }
  const { framework, target } = options;
  const root = resolve(options.path);
  const plan = options.adopt
    ? planAdoption(root, framework, target)
    : planScaffold(root, framework, target);
  applyScaffold(plan);
  process.stderr.write(
    `${options.adopt ? 'adopted' : 'initialized'} ${framework}/${target} project at ${root}\n`,
  );
  if (framework === 'foundry') {
    process.stderr.write(
      'Next: run `sunhat toolchain install` from the project directory.\n',
    );
  }
  return 0;
}

function parseInitOptions(argv: readonly string[]): InitOptions | undefined {
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
