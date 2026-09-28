import { readFile } from 'node:fs/promises';
import { SunhatBuildError } from './errors.js';
import { sha256 } from './hash.js';
import type { NormalizedCompilerConfig } from '../config/index.js';

export async function verifyCompilerIntegrity(
  compiler: NormalizedCompilerConfig
): Promise<void> {
  if (compiler.path === undefined || compiler.sha256 === undefined) {
    if (compiler.kind === 'tron-solc' || compiler.kind === 'vyper') {
      throw new SunhatBuildError(
        'MISSING_COMPILER_EXECUTABLE',
        `${compiler.id} requires an absolute compiler path and SHA-256`
      );
    }
    return;
  }

  let compilerBytes: Buffer;
  try {
    compilerBytes = await readFile(compiler.path);
  } catch (error) {
    throw new SunhatBuildError(
      'MISSING_COMPILER_EXECUTABLE',
      `${compiler.id} cannot read compiler path ${compiler.path}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const digest = sha256(compilerBytes);
  if (digest !== compiler.sha256) {
    throw new SunhatBuildError(
      'COMPILER_INTEGRITY_MISMATCH',
      `${compiler.id} SHA-256 mismatch: expected ${compiler.sha256}, received ${digest}`
    );
  }
}
