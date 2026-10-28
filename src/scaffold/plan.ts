import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { CliError, usage } from '../errors.js';
import { packageRoot, readPackageMetadata } from '../package.js';
import type { Framework, Target } from '../project/binding.js';

export interface PlannedFile {
  readonly path: string;
  readonly data: string | Buffer;
}

export interface ScaffoldPlan {
  readonly root: string;
  readonly files: readonly PlannedFile[];
}

interface TemplateValues {
  projectName: string;
  sunhatPackage: string;
  sunhatDependency: string;
}

export function planScaffold(
  directory: string,
  framework: Framework,
  target: Target,
): ScaffoldPlan {
  const root = resolve(directory);
  assertUnbound(root);
  const metadata = readPackageMetadata();
  const sunhatPackage = `${metadata.name}@${metadata.version}`;
  const values: TemplateValues = {
    projectName: basename(root),
    sunhatPackage,
    sunhatDependency: `npm:${sunhatPackage}`,
  };
  const source = resolve(packageRoot, 'templates', framework);
  const files = new Map<string, string>();
  collectTemplates(resolve(source, 'common'), '', files);
  collectTemplates(resolve(source, target), '', files);
  return {
    root,
    files: Array.from(files, ([name, from]) => ({
      path: resolve(root, name),
      data: renderTemplate(from, values),
    })),
  };
}

export function planAdoption(
  directory: string,
  framework: Framework,
  target: Target,
): ScaffoldPlan {
  const root = resolve(directory);
  validateNativeProject(root, framework);
  assertUnbound(root);
  const template = resolve(packageRoot, 'templates', framework, target);
  const names = ['sunhat.toml'];
  if (
    framework === 'foundry' &&
    !existsSync(resolve(root, 'foundry-toolchain.json'))
  ) {
    names.unshift('foundry-toolchain.json');
  }
  return {
    root,
    files: names.map((name) => ({
      path: resolve(root, name),
      data: readFileSync(resolve(template, name)),
    })),
  };
}

function assertUnbound(root: string): void {
  if (lstatSync(resolve(root, 'sunhat.toml'), { throwIfNoEntry: false })) {
    return usage(`${root} is already bound by sunhat.toml`);
  }
}

function validateNativeProject(root: string, framework: Framework): void {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    return usage(
      `cannot adopt ${framework}: project directory not found at ${root}`,
    );
  }
  const found =
    framework === 'foundry'
      ? statSync(resolve(root, 'foundry.toml'), {
          throwIfNoEntry: false,
        })?.isFile()
      : ['js', 'cjs', 'ts'].some((ext) =>
          statSync(resolve(root, `hardhat.config.${ext}`), {
            throwIfNoEntry: false,
          })?.isFile(),
        );
  if (!found) {
    throw new CliError(
      `cannot adopt ${framework}: native configuration not found in ${root}`,
      2,
    );
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

function renderTemplate(path: string, values: TemplateValues): string | Buffer {
  const contents = readFileSync(path);
  if (path.endsWith('.md')) {
    return contents
      .toString('utf8')
      .replaceAll('{{sunhatPackage}}', values.sunhatPackage);
  }
  if (!path.endsWith('.json')) {
    return contents;
  }
  // Replace complete JSON string values so Windows paths and quotes remain escaped.
  return contents
    .toString('utf8')
    .replace(
      /"\{\{(projectName|sunhatDependency)\}\}"/gu,
      (_match, key: keyof typeof values) => JSON.stringify(values[key]),
    );
}
