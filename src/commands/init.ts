import { resolve } from 'node:path';
import { parseInitOptions } from '../cli/init-options.js';
import { CliError, errorMessage } from '../errors.js';
import { applyScaffold } from '../scaffold/apply.js';
import { planAdoption, planScaffold } from '../scaffold/plan.js';
import { installFoundry } from '../toolchain/install.js';

export async function initProject(argv: readonly string[]): Promise<number> {
  const options = parseInitOptions(argv);
  if (!options) {
    process.stdout.write(
      'Usage: sunhat init [--framework <foundry|hardhat>] [--target <tron|evm>] [--adopt] [path]\nDefaults: framework=foundry, target=tron\n',
    );
    return 0;
  }
  const { framework, target } = options;
  const root = resolve(options.path);
  const plan = options.adopt
    ? planAdoption(root, framework, target)
    : planScaffold(root, framework, target);
  applyScaffold(plan);
  if (framework === 'foundry') {
    try {
      await installFoundry(root, target);
    } catch (error) {
      throw new CliError(
        `${errorMessage(error)}; project files are in ${root}; retry with \`sunhat toolchain install\``,
        error instanceof CliError ? error.exitCode : 6,
        { cause: error },
      );
    }
  }
  process.stderr.write(
    `${options.adopt ? 'adopted' : 'initialized'} ${framework}/${target} project at ${root}\n`,
  );
  return 0;
}
