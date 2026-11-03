import { fileURLToPath } from 'node:url';
import { isRecord, readJson } from '../../json.js';

interface TronDefaults {
  readonly image: string;
  readonly compilerMirror: string;
}

export function readTronDefaults(path: string): TronDefaults {
  const value = readJson(path);
  if (
    !isRecord(value) ||
    typeof value.image !== 'string' ||
    value.image.trim().length === 0 ||
    typeof value.compilerMirror !== 'string' ||
    value.compilerMirror.trim().length === 0
  ) {
    throw new Error(
      `Invalid TRON defaults in ${path}: expected non-empty image and compilerMirror strings`,
    );
  }
  return Object.freeze({
    image: value.image,
    compilerMirror: value.compilerMirror,
  });
}

export const tronDefaults = readTronDefaults(
  fileURLToPath(new URL('../../../config/tron-defaults.json', import.meta.url)),
);
