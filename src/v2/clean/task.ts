import { lstat, realpath, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { SunhatCleanError } from './errors.js';

const CLEAN_PATHS = ['artifacts/sunhat', 'cache/sunhat'] as const;
const PRESERVED_PATHS = [
  'build-snapshots',
  'deployments',
  'verification',
] as const;

export interface SunhatCleanResult {
  readonly preserved: readonly string[];
  readonly removed: readonly string[];
}

/** Removes only reproducible Sunhat outputs and preserves deployment evidence. */
export async function cleanSunhatProject(
  projectRoot: string
): Promise<SunhatCleanResult> {
  const root = await realpath(path.resolve(projectRoot));
  const removable: Array<{ absolutePath: string; relativePath: string }> = [];

  for (const relativePath of CLEAN_PATHS) {
    const absolutePath = path.resolve(root, relativePath);
    assertInsideRoot(root, absolutePath, relativePath);
    const state = await inspectCleanPath(root, relativePath);
    if (state === 'missing') continue;
    removable.push({ absolutePath, relativePath });
  }

  const removed: string[] = [];
  for (const { absolutePath, relativePath } of removable) {
    const tombstone = `${absolutePath}.clean-${process.pid}-${randomBytes(6).toString('hex')}`;
    await rename(absolutePath, tombstone);
    try {
      await rm(tombstone, { force: true, recursive: true });
    } catch (error) {
      try {
        await rename(tombstone, absolutePath);
      } catch {
        // Keep the original removal error; the tombstone remains recoverable.
      }
      throw error;
    }
    removed.push(relativePath);
  }

  return Object.freeze({
    preserved: Object.freeze([...PRESERVED_PATHS]),
    removed: Object.freeze(removed),
  });
}

async function inspectCleanPath(
  root: string,
  relativePath: string
): Promise<'directory' | 'missing'> {
  let current = root;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return 'missing';
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new SunhatCleanError(
        'CLEAN_PATH_UNSAFE',
        `refusing to clean through symbolic link: ${current}`
      );
    }
    if (!stats.isDirectory()) {
      throw new SunhatCleanError(
        'CLEAN_PATH_UNEXPECTED_TYPE',
        `clean path component is not a directory: ${current}`
      );
    }
  }
  return 'directory';
}

function assertInsideRoot(
  root: string,
  absolutePath: string,
  relativePath: string
): void {
  const relative = path.relative(root, absolutePath);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new SunhatCleanError(
      'CLEAN_PATH_UNSAFE',
      `clean path escapes the project root: ${relativePath}`
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
