import { SunhatDeploymentError } from './errors.js';

export type TvmBytecodeProfile = 'london';

export interface TvmBytecodeValidationResult {
  readonly executableBytes: number;
  readonly instructionCount: number;
  readonly metadataBytes: number;
  readonly profile: TvmBytecodeProfile;
}

const OPCODE_NAMES = new Map<number, string>([
  [0x1e, 'CLZ'],
  [0x49, 'BLOBHASH'],
  [0x4a, 'BLOBBASEFEE'],
  [0x5c, 'TLOAD'],
  [0x5d, 'TSTORE'],
  [0x5e, 'MCOPY'],
  [0x5f, 'PUSH0'],
]);

/**
 * Validates bytecode against Sunhat's conservative TVM London release profile.
 * PUSH immediates and a valid trailing CBOR metadata section are data, not
 * instructions, and are deliberately excluded from opcode checks.
 */
export function validateTvmBytecode(
  bytecode: string,
  profile: TvmBytecodeProfile = 'london'
): TvmBytecodeValidationResult {
  const bytes = decodeBytecode(bytecode, profile);
  const executableBytes = metadataOffset(bytes);
  let instructionCount = 0;

  for (let offset = 0; offset < executableBytes; ) {
    const opcode = bytes[offset];
    if (!isLondonOpcode(opcode)) {
      incompatible(
        `opcode ${formatOpcode(opcode)} at byte ${offset} is not supported by TVM ${profile}`,
        profile,
        offset,
        opcode
      );
    }
    ++instructionCount;
    const immediateBytes = opcode >= 0x60 && opcode <= 0x7f ? opcode - 0x5f : 0;
    if (offset + 1 + immediateBytes > executableBytes) {
      incompatible(
        `${formatOpcode(opcode)} at byte ${offset} has truncated immediate data`,
        profile,
        offset,
        opcode
      );
    }
    offset += 1 + immediateBytes;
  }

  return Object.freeze({
    executableBytes,
    instructionCount,
    metadataBytes: bytes.length - executableBytes,
    profile,
  });
}

function decodeBytecode(
  bytecode: string,
  profile: TvmBytecodeProfile
): Uint8Array {
  const normalized = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
  if (
    normalized.length === 0 ||
    normalized.length % 2 !== 0 ||
    !/^[a-fA-F0-9]+$/.test(normalized)
  ) {
    throw new SunhatDeploymentError(
      'TVM_BYTECODE_INCOMPATIBLE',
      'TVM bytecode must be non-empty, even-length hexadecimal',
      { profile }
    );
  }
  return Uint8Array.from(Buffer.from(normalized, 'hex'));
}

function metadataOffset(bytes: Uint8Array): number {
  if (bytes.length < 3) return bytes.length;
  const metadataLength = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
  if (metadataLength === 0) return bytes.length;
  // Solidity excludes the two-byte footer from this length. Vyper >=0.3.10
  // includes it, so both compiler-defined encodings must be checked.
  const candidates = [
    bytes.length - metadataLength - 2,
    bytes.length - metadataLength,
  ];
  for (const start of candidates) {
    if (start < 0) continue;
    const major = bytes[start] >> 5;
    if (major !== 4 && major !== 5) continue;
    try {
      if (readCborItem(bytes, start, bytes.length - 2, 0) === bytes.length - 2) {
        return start;
      }
    } catch {
      // A footer-like suffix is executable code unless its CBOR is complete.
    }
  }
  return bytes.length;
}

function readCborItem(
  bytes: Uint8Array,
  offset: number,
  limit: number,
  depth: number
): number {
  if (depth > 32 || offset >= limit) throw new Error('invalid CBOR');
  const initial = bytes[offset];
  const major = initial >> 5;
  const additional = initial & 0x1f;
  if (additional === 31) {
    return readIndefiniteCbor(bytes, offset + 1, limit, depth, major);
  }
  const argument = readCborArgument(bytes, offset + 1, limit, additional);
  let cursor = argument.offset;
  if (major === 2 || major === 3) {
    return advance(cursor, argument.value, limit);
  }
  if (major === 4 || major === 5) {
    const items = major === 5 ? argument.value * 2 : argument.value;
    if (!Number.isSafeInteger(items)) throw new Error('invalid CBOR');
    for (let index = 0; index < items; ++index) {
      cursor = readCborItem(bytes, cursor, limit, depth + 1);
    }
    return cursor;
  }
  if (major === 6) {
    return readCborItem(bytes, cursor, limit, depth + 1);
  }
  return cursor;
}

function readIndefiniteCbor(
  bytes: Uint8Array,
  offset: number,
  limit: number,
  depth: number,
  major: number
): number {
  if (major !== 2 && major !== 3 && major !== 4 && major !== 5) {
    throw new Error('invalid CBOR');
  }
  let cursor = offset;
  let mapItemCount = 0;
  while (cursor < limit && bytes[cursor] !== 0xff) {
    if (major === 2 || major === 3) {
      if ((bytes[cursor] >> 5) !== major || (bytes[cursor] & 0x1f) === 31) {
        throw new Error('invalid CBOR');
      }
    }
    cursor = readCborItem(bytes, cursor, limit, depth + 1);
    ++mapItemCount;
  }
  if (cursor >= limit || (major === 5 && mapItemCount % 2 !== 0)) {
    throw new Error('invalid CBOR');
  }
  return cursor + 1;
}

function readCborArgument(
  bytes: Uint8Array,
  offset: number,
  limit: number,
  additional: number
): { readonly offset: number; readonly value: number } {
  if (additional < 24) return { offset, value: additional };
  const width =
    additional === 24
      ? 1
      : additional === 25
        ? 2
        : additional === 26
          ? 4
          : additional === 27
            ? 8
            : 0;
  if (width === 0 || offset + width > limit) throw new Error('invalid CBOR');
  let value = 0;
  for (let index = 0; index < width; ++index) {
    value = value * 256 + bytes[offset + index];
    if (!Number.isSafeInteger(value)) throw new Error('invalid CBOR');
  }
  return { offset: offset + width, value };
}

function advance(offset: number, length: number, limit: number): number {
  const end = offset + length;
  if (!Number.isSafeInteger(end) || end > limit) throw new Error('invalid CBOR');
  return end;
}

function isLondonOpcode(opcode: number): boolean {
  return (
    opcode === 0x00 ||
    (opcode >= 0x01 && opcode <= 0x0b) ||
    (opcode >= 0x10 && opcode <= 0x1d) ||
    opcode === 0x20 ||
    (opcode >= 0x30 && opcode <= 0x3f) ||
    (opcode >= 0x40 && opcode <= 0x48) ||
    (opcode >= 0x50 && opcode <= 0x5b) ||
    (opcode >= 0x60 && opcode <= 0x7f) ||
    (opcode >= 0x80 && opcode <= 0x9f) ||
    (opcode >= 0xa0 && opcode <= 0xa4) ||
    (opcode >= 0xd0 && opcode <= 0xdf) ||
    opcode === 0xf0 ||
    opcode === 0xf1 ||
    opcode === 0xf2 ||
    opcode === 0xf3 ||
    opcode === 0xf4 ||
    opcode === 0xf5 ||
    opcode === 0xfa ||
    opcode === 0xfd ||
    opcode === 0xfe ||
    opcode === 0xff
  );
}

function formatOpcode(opcode: number): string {
  const hex = `0x${opcode.toString(16).padStart(2, '0')}`;
  const name = OPCODE_NAMES.get(opcode);
  return name === undefined ? hex : `${name} (${hex})`;
}

function incompatible(
  message: string,
  profile: TvmBytecodeProfile,
  offset: number,
  opcode: number
): never {
  throw new SunhatDeploymentError('TVM_BYTECODE_INCOMPATIBLE', message, {
    offset: String(offset),
    opcode: `0x${opcode.toString(16).padStart(2, '0')}`,
    profile,
  });
}
