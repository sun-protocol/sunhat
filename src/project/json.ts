import { readFileSync } from 'node:fs';
import { errorMessage, hasErrorCode, toolchainError } from '../errors.js';

export function readJson(path: string, missingMessage?: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (missingMessage && hasErrorCode(error, 'ENOENT')) {
      return toolchainError(missingMessage, { cause: error });
    }
    return toolchainError(
      `cannot read JSON file ${path}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
