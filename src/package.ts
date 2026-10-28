import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError, errorMessage } from './errors.js';
import { isRecord } from './json.js';

export const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

interface PackageMetadata {
  name: string;
  version: string;
}

export function readPackageMetadata(): PackageMetadata {
  const path = resolve(packageRoot, 'package.json');
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (
      !isRecord(value) ||
      typeof value.name !== 'string' ||
      value.name.length === 0 ||
      typeof value.version !== 'string' ||
      value.version.length === 0
    ) {
      throw new Error('expected non-empty package name and version strings');
    }
    return { name: value.name, version: value.version };
  } catch (error) {
    throw new CliError(
      `cannot read Sunhat package metadata ${path}: ${errorMessage(error)}`,
      6,
      { cause: error },
    );
  }
}
