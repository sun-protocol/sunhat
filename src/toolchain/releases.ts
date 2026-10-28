import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Target } from '../project/binding.js';
import { toolchainError } from '../errors.js';
import { packageRoot } from '../package.js';
import { isRecord, readJson } from '../json.js';
import type { FoundryTool } from './lock.js';

export interface Release {
  source: string;
  release: string;
  revision: string;
  archive: string;
  sha256: string;
  tools: Record<FoundryTool, string>;
}

export function platformKey(): string {
  return `${process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`;
}

export function releaseFor(target: Target, root?: string): Release {
  const local = root ? resolve(root, 'foundry-toolchain.json') : undefined;
  const path =
    local && existsSync(local)
      ? local
      : resolve(
          packageRoot,
          'templates',
          'foundry',
          target,
          'foundry-toolchain.json',
        );
  const config = readJson(path);
  if (!isRecord(config) || config.target !== target) {
    return toolchainError(
      `Foundry toolchain configuration target does not match ${target}: ${path}`,
    );
  }
  const { source, release, revision, platforms } = config;
  if (
    typeof source !== 'string' ||
    !source ||
    typeof release !== 'string' ||
    !release ||
    typeof revision !== 'string' ||
    !revision ||
    !isRecord(platforms)
  ) {
    return toolchainError(`invalid Foundry toolchain configuration: ${path}`);
  }
  const artifact = platforms[platformKey()];
  if (artifact === undefined) {
    return toolchainError(
      `unsupported Foundry platform ${process.platform}-${process.arch}`,
    );
  }
  if (
    !isRecord(artifact) ||
    !isFilename(artifact.archive) ||
    typeof artifact.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/iu.test(artifact.sha256) ||
    !isToolMap(artifact.tools)
  ) {
    return toolchainError(`invalid Foundry toolchain configuration: ${path}`);
  }
  return {
    source,
    release,
    revision,
    archive: artifact.archive,
    sha256: artifact.sha256.toLowerCase(),
    tools: artifact.tools,
  };
}

function isToolMap(value: unknown): value is Release['tools'] {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    ['forge', 'cast', 'anvil', 'chisel'].every((tool) =>
      isFilename(value[tool]),
    )
  );
}

function isFilename(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    basename(value) === value &&
    !value.includes('\\')
  );
}

export function releaseUrl(release: Release): string {
  return `https://github.com/${release.source}/releases/download/${release.release}/${release.archive}`;
}
