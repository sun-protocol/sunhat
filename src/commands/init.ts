import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CliError, usage } from '../errors.js';
import type { Framework, Target } from '../project/binding.js';
import { parseTarget } from '../cli/parser.js';
import { installFoundry } from '../toolchain/install.js';

interface InitOptions {
  framework: Framework;
  target: Target;
  path: string;
  adopt: boolean;
}
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export async function initProject(argv: readonly string[]): Promise<number> {
  const options = parseOptions(argv);
  if (!options) {
    process.stdout.write(
      'Usage: sunhat init [--framework <foundry|hardhat>] [--target <tron|evm>] [--adopt] [path]\nDefaults: framework=foundry, target=tron\n',
    );
    return 0;
  }
  const { framework, target } = options;
  const root = resolve(options.path);
  mkdirSync(root, { recursive: true });
  if (existsSync(resolve(root, 'sunhat.toml'))) {
    return usage(`${root} is already bound by sunhat.toml`);
  }
  const template = resolve(packageRoot, 'templates', framework, target);
  if (options.adopt) {
    validateNativeProject(root, framework);
    const configuration = resolve(root, 'foundry-toolchain.json');
    if (framework === 'foundry' && !existsSync(configuration)) {
      copyExclusive(resolve(template, 'foundry-toolchain.json'), configuration);
    }
    copyExclusive(
      resolve(template, 'sunhat.toml'),
      resolve(root, 'sunhat.toml'),
    );
  } else {
    scaffold(root, framework, target);
  }
  if (framework === 'foundry') {
    try {
      await installFoundry(root, target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(
        `${message}; project files are in ${root}; retry with \`sunhat toolchain install\``,
        error instanceof CliError ? error.exitCode : 6,
      );
    }
  }
  process.stderr.write(
    `${options.adopt ? 'adopted' : 'initialized'} ${framework}/${target} project at ${root}\n`,
  );
  return 0;
}
function parseOptions(argv: readonly string[]): InitOptions | undefined {
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
    return usage(error instanceof Error ? error.message : String(error));
  }
}
function validateNativeProject(root: string, framework: Framework): void {
  const found =
    framework === 'foundry'
      ? existsSync(resolve(root, 'foundry.toml'))
      : ['js', 'cjs', 'ts'].some((ext) =>
          existsSync(resolve(root, `hardhat.config.${ext}`)),
        );
  if (!found) {
    throw new CliError(
      `cannot adopt ${framework}: native configuration not found in ${root}`,
      2,
    );
  }
}
function scaffold(root: string, framework: Framework, target: Target): void {
  const source = resolve(packageRoot, 'templates', framework);
  const files = new Map<string, string>();
  collectTemplates(resolve(source, 'common'), '', files);
  collectTemplates(resolve(source, target), '', files);
  const outputs = Array.from(files, ([name, from]) => ({
    path: resolve(root, name),
    data: renderTemplate(from, root),
  }));
  const checked = new Set<string>();
  for (const file of outputs) {
    validateParentDirectories(dirname(file.path), root, checked);
  }
  const conflict = outputs.find((file) =>
    lstatSync(file.path, { throwIfNoEntry: false }),
  );
  if (conflict) {
    throw new CliError(
      `refusing to overwrite existing file ${conflict.path}`,
      2,
    );
  }
  for (const file of outputs) {
    writeExclusive(file.path, file.data);
  }
}
function validateParentDirectories(
  directory: string,
  root: string,
  checked: Set<string>,
): void {
  const parents: string[] = [];
  for (let path = directory; path !== root; path = dirname(path)) {
    parents.push(path);
  }
  for (const path of parents.reverse()) {
    if (checked.has(path)) {
      continue;
    }
    const entry = lstatSync(path, { throwIfNoEntry: false });
    if (
      entry &&
      !entry.isDirectory() &&
      !(
        entry.isSymbolicLink() &&
        statSync(path, { throwIfNoEntry: false })?.isDirectory()
      )
    ) {
      throw new CliError(`parent path is not a directory: ${path}`, 2);
    }
    checked.add(path);
  }
}
function collectTemplates(
  directory: string,
  relativePath: string,
  files: Map<string, string>,
): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const name = join(relativePath, entry.name);
    if (entry.isDirectory()) {
      collectTemplates(path, name, files);
    } else if (entry.isFile()) {
      files.set(name, path);
    } else {
      throw new CliError(`unsupported template entry ${path}`, 2);
    }
  }
}
function renderTemplate(path: string, root: string): string | Buffer {
  const contents = readFileSync(path);
  if (!path.endsWith('.json')) {
    return contents;
  }
  const values = {
    projectName: basename(root),
    sunhatDependency: `file:${packageRoot}`,
  };
  // Replace complete JSON string values so Windows paths and quotes remain escaped.
  return contents
    .toString('utf8')
    .replace(
      /"\{\{(projectName|sunhatDependency)\}\}"/gu,
      (_match, key: keyof typeof values) => JSON.stringify(values[key]),
    );
}
function copyExclusive(from: string, to: string): void {
  writeExclusive(to, readFileSync(from));
}
function writeExclusive(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, data, { flag: 'wx' });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new CliError(`refusing to overwrite existing file ${path}`, 2, {
        cause: error,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`cannot write file ${path}: ${message}`, 6, {
      cause: error,
    });
  }
}
