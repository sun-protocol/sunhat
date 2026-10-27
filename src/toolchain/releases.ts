import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Target } from '../project/binding.js';
import { toolchainError } from '../errors.js';

export interface Release {
  source: string;
  release: string;
  revision: string;
  archive: string;
  sha256: string;
  tools: Record<'forge' | 'cast' | 'anvil' | 'chisel', string>;
}
interface ReleaseConfig extends Pick<
  Release,
  'source' | 'release' | 'revision'
> {
  target: Target;
  platforms: Record<string, Pick<Release, 'archive' | 'sha256' | 'tools'>>;
}
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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
  let config: ReleaseConfig;
  try {
    config = JSON.parse(readFileSync(path, 'utf8')) as ReleaseConfig;
  } catch {
    return toolchainError(
      `cannot read Foundry toolchain configuration: ${path}`,
    );
  }
  if (!config || config.target !== target) {
    return toolchainError(
      `Foundry toolchain configuration target does not match ${target}: ${path}`,
    );
  }
  const artifact = config.platforms?.[platformKey()];
  if (!artifact) {
    return toolchainError(
      `unsupported Foundry platform ${process.platform}-${process.arch}`,
    );
  }
  if (
    ![config.source, config.release, config.revision].every(
      (value) => typeof value === 'string' && value.length > 0,
    ) ||
    !isFilename(artifact.archive) ||
    typeof artifact.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/iu.test(artifact.sha256) ||
    !artifact.tools ||
    Object.keys(artifact.tools).length !== 4 ||
    !['forge', 'cast', 'anvil', 'chisel'].every((tool) =>
      isFilename(artifact.tools[tool as keyof Release['tools']]),
    )
  ) {
    return toolchainError(`invalid Foundry toolchain configuration: ${path}`);
  }
  return {
    source: config.source,
    release: config.release,
    revision: config.revision,
    archive: artifact.archive,
    sha256: artifact.sha256.toLowerCase(),
    tools: artifact.tools,
  };
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
