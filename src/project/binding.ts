import { readFileSync } from 'node:fs';
import { CliError, errorMessage } from '../errors.js';
import { parseToml } from './toml.js';

export type Framework = 'hardhat' | 'foundry';
export type Target = 'tron' | 'evm';

export interface Binding {
  readonly framework: Framework;
  readonly target: Target;
}

export function readBinding(path: string): Binding {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new CliError(`cannot read ${path}: ${errorMessage(error)}`, 4, {
      cause: error,
    });
  }
  let document: unknown;
  try {
    document = parseToml(text);
  } catch (error) {
    throw new CliError(`invalid TOML in ${path}: ${errorMessage(error)}`, 4, {
      cause: error,
    });
  }
  return validateBinding(document, path);
}

export function validateBinding(document: unknown, path: string): Binding {
  const project = isTable(document) ? document.project : undefined;
  if (!isTable(project)) {
    throw new CliError(
      `invalid project binding in ${path}; expected a [project] table`,
      4,
    );
  }
  const { framework, target } = project;
  if (framework !== 'hardhat' && framework !== 'foundry') {
    throw new CliError(
      `invalid framework in ${path}; expected hardhat or foundry`,
      4,
    );
  }
  if (target !== 'tron' && target !== 'evm') {
    throw new CliError(`invalid target in ${path}; expected tron or evm`, 4);
  }
  return { framework, target };
}

function isTable(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
