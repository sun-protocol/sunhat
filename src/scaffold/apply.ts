import { lstatSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CliError, errorMessage, hasErrorCode } from '../errors.js';
import type { ScaffoldPlan } from './plan.js';

export function applyScaffold(plan: ScaffoldPlan): void {
  const checked = new Set<string>();
  for (const file of plan.files) {
    validateParentDirectories(dirname(file.path), plan.root, checked);
  }
  const conflict = plan.files.find((file) =>
    lstatSync(file.path, { throwIfNoEntry: false }),
  );
  if (conflict) {
    throw new CliError(
      `refusing to overwrite existing file ${conflict.path}`,
      2,
    );
  }
  for (const file of plan.files) {
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

function writeExclusive(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, data, { flag: 'wx' });
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) {
      throw new CliError(`refusing to overwrite existing file ${path}`, 2, {
        cause: error,
      });
    }
    throw new CliError(`cannot write file ${path}: ${errorMessage(error)}`, 6, {
      cause: error,
    });
  }
}
