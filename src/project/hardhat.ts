import { toolchainError } from '../errors.js';
import { isRecord, readJson } from '../json.js';
import type { Target } from './binding.js';

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
  const match = version.match(/^(\d+)\.(\d+)\.\d+$/u);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return (major === 22 && minor >= 13) || (major >= 24 && major % 2 === 0);
}

export function assertHardhatTarget(major: HardhatMajor, target: Target): void {
  if (major === 3 && target === 'tron') {
    return toolchainError(
      'Hardhat 3/TRON is not available yet; a compatible TRON plugin is required',
    );
  }
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
