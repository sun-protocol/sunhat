import { readFileSync } from 'node:fs';
import { CliError } from '../errors.js';
export type Framework = 'hardhat' | 'foundry';
export type Target = 'tron' | 'evm';
export interface Binding { framework: Framework; target: Target }
export function readBinding(path: string): Binding {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (error) { throw new CliError(`cannot read ${path}: ${msg(error)}`, 4); }
  let section = '';
  const values = new Map<string, string>();
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/\s+#.*$/u, '').trim();
    if (!line) continue;
    const header = /^\[(.+)\]$/u.exec(line);
    if (header) { section = header[1] ?? ''; continue; }
    if (section !== 'project') continue;
    const assignment = /^(framework|target)\s*=\s*"([^"]+)"\s*$/u.exec(line);
    if (!assignment) throw new CliError(`invalid project binding in ${path}: ${line}`, 4);
    values.set(assignment[1]!, assignment[2]!);
  }
  const framework = values.get('framework'); const target = values.get('target');
  if (framework !== 'hardhat' && framework !== 'foundry') throw new CliError(`invalid framework in ${path}; expected hardhat or foundry`, 4);
  if (target !== 'tron' && target !== 'evm') throw new CliError(`invalid target in ${path}; expected tron or evm`, 4);
  return { framework, target };
}
function msg(error: unknown): string { return error instanceof Error ? error.message : String(error); }
