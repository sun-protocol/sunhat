import path from 'node:path';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { SunhatBuildError } from './errors.js';
import { sha256 } from './hash.js';
import type { BuildSource, SourceLanguage } from './types.js';

export async function discoverBuildSources(
  projectRoot: string,
  sourcePaths: readonly string[]
): Promise<readonly BuildSource[]> {
  const realProjectRoot = await realpath(projectRoot);
  const sources = new Map<string, BuildSource>();

  for (const sourcePath of sourcePaths) {
    const absoluteSourcePath = path.resolve(realProjectRoot, sourcePath);
    assertInside(realProjectRoot, absoluteSourcePath, sourcePath);
    await walkSourcePath(realProjectRoot, absoluteSourcePath, sources);
  }

  return Object.freeze(
    [...sources.values()].sort((left, right) =>
      left.sourceName.localeCompare(right.sourceName)
    )
  );
}

async function walkSourcePath(
  projectRoot: string,
  currentPath: string,
  sources: Map<string, BuildSource>
): Promise<void> {
  const stats = await lstat(currentPath);
  if (stats.isSymbolicLink()) {
    throw new SunhatBuildError(
      'UNSUPPORTED_SOURCE_LAYOUT',
      `symbolic links are not allowed in configured source roots: ${currentPath}`
    );
  }
  const resolvedPath = await realpath(currentPath);
  assertInside(projectRoot, resolvedPath, currentPath);

  if (stats.isDirectory()) {
    const entries = (await readdir(currentPath)).sort();
    for (const entry of entries) {
      await walkSourcePath(projectRoot, path.join(currentPath, entry), sources);
    }
    return;
  }
  if (!stats.isFile()) {
    return;
  }

  const language = sourceLanguage(currentPath);
  if (language === undefined) {
    return;
  }
  const sourceName = path.relative(projectRoot, resolvedPath).split(path.sep).join('/');
  const content = await readFile(resolvedPath, 'utf8');
  sources.set(
    sourceName,
    Object.freeze({
      absolutePath: resolvedPath,
      content,
      language,
      sha256: sha256(content),
      sourceName,
    })
  );
}

function sourceLanguage(filePath: string): SourceLanguage | undefined {
  if (filePath.endsWith('.sol')) {
    return 'solidity';
  }
  if (filePath.endsWith('.vy')) {
    return 'vyper';
  }
  if (filePath.endsWith('.vyi')) {
    return 'vyper-interface';
  }
  if (filePath.endsWith('.json')) {
    return 'json';
  }
  return undefined;
}

function assertInside(
  projectRoot: string,
  candidatePath: string,
  configuredPath: string
): void {
  const relative = path.relative(projectRoot, candidatePath);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new SunhatBuildError(
      'SOURCE_OUTSIDE_PROJECT',
      `source path escapes the project: ${configuredPath}`
    );
  }
}
