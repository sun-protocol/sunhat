import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import type { TomlTable } from 'smol-toml';
import { CliError } from '../errors.js';
export type Framework = 'hardhat' | 'foundry';
export type Target = 'tron' | 'evm';
export interface Binding {
  framework: Framework;
  target: Target;
}
export function readBinding(path: string): Binding {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new CliError(`cannot read ${path}: ${msg(error)}`, 4);
  }
  let document: TomlTable;
  try {
    document = parse(text);
  } catch (error) {
    throw new CliError(`invalid TOML in ${path}: ${msg(error)}`, 4);
  }
  const project = document.project;
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new CliError(
      `invalid project binding in ${path}; expected a [project] table`,
      4,
    );
  }
  const framework = 'framework' in project ? project.framework : undefined;
  const target = 'target' in project ? project.target : undefined;
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
function msg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
