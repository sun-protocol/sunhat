import { readFileSync } from 'node:fs';
import { toolchainError } from '../errors.js';

export function readJson(path: string, missingMessage?: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (
      missingMessage &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return toolchainError(missingMessage);
    }
    const message = error instanceof Error ? error.message : String(error);
    return toolchainError(`cannot read JSON file ${path}: ${message}`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
