import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CliError, errorMessage, usage } from '../errors.js';
import type { Framework, Target } from '../project/binding.js';
import type { HardhatMajor } from '../project/hardhat.js';
import { applyScaffold } from '../scaffold/apply.js';
import { planAdoption, planScaffold } from '../scaffold/plan.js';
import { parseTarget } from './parser.js';

interface InitOptions {
  readonly framework: Framework;
  readonly target: Target;
  readonly path: string;
  readonly adopt: boolean;
  readonly hardhatVersion?: HardhatMajor;
}

export function initProject(argv: readonly string[]): number {
  const options = parseInitOptions(argv);
  if (!options) {
    process.stdout.write(
      'Usage: sunhat init [--framework <foundry|hardhat>] [--hardhat-version <2|3>] [--target <tron|evm>] [--adopt] [path]\nDefaults: framework=foundry, target=tron; hardhat-version=2 for new Hardhat projects\nCreates project files only; install framework dependencies separately.\nHardhat 3 supports EVM and TRON.\n',
    );
    return 0;
  }
  const { framework, target } = options;
  const root = resolve(options.path);
  const plan = options.adopt
    ? planAdoption(root, framework, target, options.hardhatVersion)
    : planScaffold(root, framework, target, options.hardhatVersion);
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
        'hardhat-version': { type: 'string' },
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
    const version = values['hardhat-version'];
    if (version !== undefined && framework !== 'hardhat') {
      return usage('--hardhat-version requires --framework hardhat');
    }
    if (version !== undefined && version !== '2' && version !== '3') {
      return usage('--hardhat-version requires 2 or 3');
    }
    return {
      framework,
      target: parseTarget(values.target),
      path: positionals[0] ?? '.',
      adopt: values.adopt,
      ...(version === undefined
        ? {}
        : { hardhatVersion: version === '2' ? 2 : 3 }),
    };
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    return usage(errorMessage(error), { cause: error });
  }
}
