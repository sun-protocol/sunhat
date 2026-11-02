import { toolchainError } from '../errors.js';
import { isRecord, readJson } from '../json.js';
import { isSupportedNode } from '../runtime.js';

export type HardhatMajor = 2 | 3;

export interface HardhatPackage {
  readonly version?: string;
  readonly type?: string;
  readonly bin?: string | Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

export function hardhatMajor(
  version: string | undefined,
): HardhatMajor | undefined {
  const match = version?.match(
    /^([23])\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/u,
  );
  return match?.[1] === '2' ? 2 : match?.[1] === '3' ? 3 : undefined;
}

export function isHardhat3NodeSupported(version: string): boolean {
  return isSupportedNode(version, { major: 22, minor: 13 });
}

export function readHardhatPackage(path: string): HardhatPackage {
  const value = readJson(path);
  if (
    !isRecord(value) ||
    (value.version !== undefined && typeof value.version !== 'string') ||
    (value.type !== undefined && typeof value.type !== 'string') ||
    (value.bin !== undefined &&
      typeof value.bin !== 'string' &&
      !isStringRecord(value.bin)) ||
    (value.dependencies !== undefined && !isStringRecord(value.dependencies)) ||
    (value.devDependencies !== undefined &&
      !isStringRecord(value.devDependencies))
  ) {
    return toolchainError(`invalid package manifest: ${path}`);
  }
  return value;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}
