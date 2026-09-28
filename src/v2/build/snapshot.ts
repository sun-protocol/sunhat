import path from 'node:path';
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { SunhatBuildError } from './errors.js';
import { canonicalJson, sha256 } from './hash.js';
import type {
  BuildIdentity,
  BuildManifest,
  BuildManifestFile,
  BuildSource,
} from './types.js';

export interface CommitSnapshotOptions {
  readonly artifactDirectory: string;
  readonly buildId: string;
  readonly buildIdentity: BuildIdentity;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly projectRoot: string;
  readonly sources: readonly BuildSource[];
  readonly targetName: string;
}

export function buildIdForIdentity(identity: BuildIdentity): string {
  return sha256(canonicalJson(identity));
}

export function snapshotDirectory(
  projectRoot: string,
  targetName: string,
  buildId: string
): string {
  return path.join(projectRoot, 'build-snapshots', targetName, buildId);
}

export async function restoreSnapshotIfValid(
  projectRoot: string,
  targetName: string,
  buildId: string,
  artifactDirectory: string
): Promise<boolean> {
  const directory = snapshotDirectory(projectRoot, targetName, buildId);
  try {
    await validateSnapshot(directory, buildId);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  const temporaryDirectory =
    `${artifactDirectory}.restore-${process.pid}-` +
    randomBytes(6).toString('hex');
  await rm(temporaryDirectory, { force: true, recursive: true });
  try {
    await copyTree(path.join(directory, 'artifacts'), temporaryDirectory);
    await validateSnapshot(directory, buildId);
    await rm(artifactDirectory, { force: true, recursive: true });
    await mkdir(path.dirname(artifactDirectory), { recursive: true });
    await rename(temporaryDirectory, artifactDirectory);
    return true;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

export async function commitBuildSnapshot(
  options: CommitSnapshotOptions
): Promise<string> {
  assertCommitIdentity(options);
  const finalDirectory = snapshotDirectory(
    options.projectRoot,
    options.targetName,
    options.buildId
  );
  const parentDirectory = path.dirname(finalDirectory);
  await mkdir(parentDirectory, { recursive: true });

  try {
    await validateSnapshot(finalDirectory, options.buildId);
    return finalDirectory;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  const temporaryDirectory = path.join(
    parentDirectory,
    `.tmp-${options.buildId}-${process.pid}-${randomBytes(6).toString('hex')}`
  );
  await mkdir(temporaryDirectory);
  try {
    await copyTree(
      options.artifactDirectory,
      path.join(temporaryDirectory, 'artifacts')
    );
    for (const source of options.sources) {
      const outputPath = safeSnapshotPath(
        temporaryDirectory,
        path.join('sources', source.sourceName)
      );
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, source.content, { encoding: 'utf8', flag: 'wx' });
    }
    await writeFile(
      path.join(temporaryDirectory, 'metadata.json'),
      `${canonicalJson(options.metadata)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );

    const files = await hashSnapshotFiles(temporaryDirectory);
    const manifest: BuildManifest = {
      schema: 'sunhat-build-snapshot-2',
      buildId: options.buildId,
      build: options.buildIdentity,
      files,
    };
    await writeFile(
      path.join(temporaryDirectory, 'manifest.json'),
      `${canonicalJson(manifest)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );

    try {
      await rename(temporaryDirectory, finalDirectory);
    } catch (error) {
      if (!isNodeError(error) || !['EEXIST', 'ENOTEMPTY'].includes(error.code ?? '')) {
        throw error;
      }
      await validateSnapshot(finalDirectory, options.buildId);
    }
    return finalDirectory;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function assertCommitIdentity(options: CommitSnapshotOptions): void {
  const sources = options.sources.map(({ sha256: sourceSha256, sourceName }) => ({
    sha256: sourceSha256,
    sourceName,
  }));
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.targetName) ||
    !/^[a-f0-9]{64}$/.test(options.buildId) ||
    !isBuildIdentity(options.buildIdentity) ||
    options.buildIdentity.target !== options.targetName ||
    buildIdForIdentity(options.buildIdentity) !== options.buildId ||
    canonicalJson(sources) !== canonicalJson(options.buildIdentity.sources)
  ) {
    throw new SunhatBuildError(
      'SNAPSHOT_INTEGRITY_MISMATCH',
      'snapshot commit identity does not match its target, build id, or sources'
    );
  }
}

export async function validateSnapshot(
  directory: string,
  expectedBuildId: string
): Promise<BuildManifest> {
  const manifestPath = path.join(directory, 'manifest.json');
  const manifestStats = await lstat(manifestPath);
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    throw new SunhatBuildError(
      'SNAPSHOT_INTEGRITY_MISMATCH',
      `snapshot manifest is not a regular file: ${manifestPath}`
    );
  }
  let manifest: BuildManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BuildManifest;
  } catch (error) {
    throw new SunhatBuildError(
      'SNAPSHOT_INTEGRITY_MISMATCH',
      `cannot parse build snapshot manifest ${manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (
    manifest.schema !== 'sunhat-build-snapshot-2' ||
    manifest.buildId !== expectedBuildId ||
    !isBuildIdentity(manifest.build) ||
    buildIdForIdentity(manifest.build) !== expectedBuildId ||
    !Array.isArray(manifest.files)
  ) {
    throw new SunhatBuildError(
      'SNAPSHOT_INTEGRITY_MISMATCH',
      `invalid build snapshot manifest: ${manifestPath}`
    );
  }
  for (const file of manifest.files) {
    if (
      typeof file.path !== 'string' ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0
    ) {
      throw new SunhatBuildError(
        'SNAPSHOT_INTEGRITY_MISMATCH',
        `invalid snapshot file entry in ${manifestPath}`
      );
    }
    const filePath = safeSnapshotPath(directory, file.path);
    const stats = await lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new SunhatBuildError(
        'SNAPSHOT_INTEGRITY_MISMATCH',
        `snapshot entry is not a regular file: ${file.path}`
      );
    }
    const content = await readFile(filePath);
    if (stats.size !== file.size || sha256(content) !== file.sha256) {
      throw new SunhatBuildError(
        'SNAPSHOT_INTEGRITY_MISMATCH',
        `snapshot file hash mismatch: ${file.path}`
      );
    }
  }

  const expectedFiles = [...manifest.files].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
  const actualFiles = await hashSnapshotFiles(
    directory,
    new Set(['manifest.json'])
  );
  if (canonicalJson(actualFiles) !== canonicalJson(expectedFiles)) {
    throw new SunhatBuildError(
      'SNAPSHOT_INTEGRITY_MISMATCH',
      `snapshot contains untracked, duplicate, or missing files: ${directory}`
    );
  }
  const actualSources = actualFiles
    .filter(({ path: filePath }) => filePath.startsWith('sources/'))
    .map(({ path: filePath, sha256: fileSha256 }) => ({
      sha256: fileSha256,
      sourceName: filePath.slice('sources/'.length),
    }));
  const expectedSources = [...manifest.build.sources].sort((left, right) =>
    left.sourceName.localeCompare(right.sourceName)
  );
  if (canonicalJson(actualSources) !== canonicalJson(expectedSources)) {
    throw new SunhatBuildError(
      'SNAPSHOT_INTEGRITY_MISMATCH',
      `snapshot source hashes do not match archived sources: ${directory}`
    );
  }
  return manifest;
}

function isBuildIdentity(value: unknown): value is BuildIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const identity = value as Record<string, unknown>;
  if (
    identity.schema !== 'sunhat-build-identity-2' ||
    (identity.chain !== 'evm' && identity.chain !== 'tron') ||
    typeof identity.target !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identity.target) ||
    !Array.isArray(identity.compilers) ||
    !Array.isArray(identity.sources) ||
    !isStringRecord(identity.overrides) ||
    (identity.solidityFingerprint !== undefined &&
      !isRecord(identity.solidityFingerprint))
  ) {
    return false;
  }
  return (
    identity.compilers.every(isCompilerIdentity) &&
    identity.sources.every(isSourceIdentity)
  );
}

function isCompilerIdentity(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    (value.kind === 'solc' ||
      value.kind === 'tron-solc' ||
      value.kind === 'vyper') &&
    typeof value.version === 'string' &&
    isRecord(value.settings) &&
    (value.sha256 === undefined ||
      (typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)))
  );
}

function isSourceIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.sourceName === 'string' &&
    value.sourceName.length > 0 &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  );
}

function isStringRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function hashSnapshotFiles(
  directory: string,
  excludedPaths: ReadonlySet<string> = new Set()
): Promise<BuildManifestFile[]> {
  const files: BuildManifestFile[] = [];
  await visit(directory, '');
  return files.sort((left, right) => left.path.localeCompare(right.path));

  async function visit(absoluteDirectory: string, relativeDirectory: string) {
    for (const entry of (await readdir(absoluteDirectory)).sort()) {
      const absolutePath = path.join(absoluteDirectory, entry);
      const relativePath = path.posix.join(relativeDirectory, entry);
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new SunhatBuildError(
          'INVALID_BUILD_OUTPUT',
          `symbolic links are forbidden in build output: ${relativePath}`
        );
      }
      if (stats.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (stats.isFile()) {
        if (excludedPaths.has(relativePath)) {
          continue;
        }
        const content = await readFile(absolutePath);
        files.push(
          Object.freeze({
            path: relativePath,
            sha256: sha256(content),
            size: stats.size,
          })
        );
      } else {
        throw new SunhatBuildError(
          'INVALID_BUILD_OUTPUT',
          `special files are forbidden in build output: ${relativePath}`
        );
      }
    }
  }
}

async function copyTree(source: string, destination: string): Promise<void> {
  const stats = await lstat(source);
  if (stats.isSymbolicLink()) {
    throw new SunhatBuildError(
      'INVALID_BUILD_OUTPUT',
      `symbolic links are forbidden in build output: ${source}`
    );
  }
  if (stats.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of (await readdir(source)).sort()) {
      await copyTree(path.join(source, entry), path.join(destination, entry));
    }
  } else if (stats.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  } else {
    throw new SunhatBuildError(
      'INVALID_BUILD_OUTPUT',
      `special files are forbidden in build output: ${source}`
    );
  }
}

function safeSnapshotPath(root: string, relativePath: string): string {
  const outputPath = path.resolve(root, relativePath);
  const relative = path.relative(root, outputPath);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new SunhatBuildError(
      'SNAPSHOT_INTEGRITY_MISMATCH',
      `snapshot path escapes its directory: ${relativePath}`
    );
  }
  return outputPath;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
