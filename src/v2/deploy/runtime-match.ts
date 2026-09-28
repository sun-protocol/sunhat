import { sha256 } from '../build/index.js';
import type { RuntimeMatchResult } from './types.js';

export interface ByteReference {
  readonly length: number;
  readonly start: number;
}

export function compareRuntimeCode(
  expectedCode: string | undefined,
  observedCode: string,
  mutableReferences: readonly ByteReference[] = []
): RuntimeMatchResult {
  const observed = decodeCode(observedCode);
  const observedCodeHash = sha256(observed);
  if (expectedCode === undefined) {
    return {
      observedCodeHash,
      reason: 'artifact does not contain deployed runtime bytecode',
      status: 'insufficient',
    };
  }
  const expected = decodeCode(expectedCode);
  const expectedCodeHash = sha256(expected);
  if (expected.equals(observed)) {
    return { expectedCodeHash, observedCodeHash, status: 'exact' };
  }
  if (expected.length !== observed.length) {
    return {
      expectedCodeHash,
      observedCodeHash,
      reason: 'runtime bytecode lengths differ',
      status: 'mismatch',
    };
  }
  const allowed = new Uint8Array(expected.length);
  for (const reference of mutableReferences) {
    if (
      !Number.isSafeInteger(reference.start) ||
      !Number.isSafeInteger(reference.length) ||
      reference.start < 0 ||
      reference.length <= 0 ||
      reference.start + reference.length > expected.length
    ) {
      return {
        expectedCodeHash,
        observedCodeHash,
        reason: 'artifact contains an invalid mutable byte range',
        status: 'insufficient',
      };
    }
    allowed.fill(1, reference.start, reference.start + reference.length);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== observed[index] && allowed[index] !== 1) {
      return {
        expectedCodeHash,
        observedCodeHash,
        reason: `runtime differs at immutable byte offset ${index}`,
        status: 'mismatch',
      };
    }
  }
  if (mutableReferences.length === 0) {
    return {
      expectedCodeHash,
      observedCodeHash,
      reason: 'runtime differs and the artifact declares no link or immutable ranges',
      status: 'mismatch',
    };
  }
  return { expectedCodeHash, observedCodeHash, status: 'normalized' };
}

export function collectMutableReferences(artifact: unknown): ByteReference[] {
  if (artifact === null || typeof artifact !== 'object') {
    return [];
  }
  const record = artifact as Record<string, unknown>;
  return [
    ...readNestedReferences(record.deployedLinkReferences),
    ...readNestedReferences(record.immutableReferences),
  ].sort((left, right) => left.start - right.start || left.length - right.length);
}

export function collectCreationLinkReferences(artifact: unknown): ByteReference[] {
  if (artifact === null || typeof artifact !== 'object') return [];
  return readNestedReferences(
    (artifact as Record<string, unknown>).linkReferences
  ).sort((left, right) => left.start - right.start || left.length - right.length);
}

function readNestedReferences(value: unknown): ByteReference[] {
  const references: ByteReference[] = [];
  visit(value);
  return references;

  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      for (const entry of current) {
        if (entry !== null && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          if (
            typeof record.start === 'number' &&
            typeof record.length === 'number'
          ) {
            references.push({ start: record.start, length: record.length });
          } else {
            visit(entry);
          }
        }
      }
    } else if (current !== null && typeof current === 'object') {
      for (const entry of Object.values(current as Record<string, unknown>)) {
        visit(entry);
      }
    }
  }
}

function decodeCode(code: string): Buffer {
  const normalized = code.startsWith('0x') ? code.slice(2) : code;
  if (normalized.length % 2 !== 0 || !/^[a-fA-F0-9]*$/.test(normalized)) {
    throw new TypeError('runtime bytecode must be an even-length hexadecimal string');
  }
  return Buffer.from(normalized, 'hex');
}
