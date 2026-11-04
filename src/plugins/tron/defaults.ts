import { fileURLToPath } from 'node:url';
import { isRecord, readJson } from '../../json.js';

interface TronDefaults {
  readonly image: string;
  readonly compilerMirror: string;
  readonly jdkImage: string;
  readonly localCompiler: { readonly version: string; readonly sha256: string };
}

export function readTronDefaults(path: string): TronDefaults {
  const value = readJson(path);
  if (
    !isRecord(value) ||
    typeof value.image !== 'string' ||
    value.image.trim().length === 0 ||
    typeof value.compilerMirror !== 'string' ||
    value.compilerMirror.trim().length === 0 ||
    typeof value.jdkImage !== 'string' ||
    value.jdkImage.trim().length === 0 ||
    !isRecord(value.localCompiler) ||
    typeof value.localCompiler.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/u.test(value.localCompiler.version) ||
    typeof value.localCompiler.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.localCompiler.sha256)
  ) {
    throw new Error(
      `Invalid TRON defaults in ${path}: expected image, compilerMirror, jdkImage and a versioned localCompiler SHA-256`,
    );
  }
  return Object.freeze({
    image: value.image,
    compilerMirror: value.compilerMirror,
    jdkImage: value.jdkImage,
    localCompiler: Object.freeze({
      version: value.localCompiler.version,
      sha256: value.localCompiler.sha256,
    }),
  });
}

export const tronDefaults = readTronDefaults(
  fileURLToPath(new URL('../../../config/tron-defaults.json', import.meta.url)),
);
