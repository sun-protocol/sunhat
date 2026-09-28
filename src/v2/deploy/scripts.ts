import path from 'node:path';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { sha256 } from '../build/index.js';
import { SunhatDeploymentError } from './errors.js';

export type DeploymentScript<Context> = (context: Context) => Promise<void>;

export async function discoverDeploymentScripts(
  projectRoot: string,
  relativeDirectory = 'deploy'
): Promise<readonly string[]> {
  const root = await realpath(path.resolve(projectRoot));
  const directory = path.resolve(root, relativeDirectory);
  assertWithin(root, directory);
  let directoryStats;
  try {
    directoryStats = await lstat(directory);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    unsafe(`deployment script path is not a regular directory: ${directory}`);
  }
  const scripts: string[] = [];
  await visit(directory);
  return Object.freeze(scripts.sort((left, right) => left.localeCompare(right)));

  async function visit(currentDirectory: string): Promise<void> {
    for (const name of (await readdir(currentDirectory)).sort()) {
      const absolute = path.join(currentDirectory, name);
      assertWithin(directory, absolute);
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink()) {
        unsafe(`symbolic links are forbidden in deployment scripts: ${absolute}`);
      }
      if (stats.isDirectory()) {
        await visit(absolute);
      } else if (stats.isFile() && /\.(?:[cm]?[jt]s)$/.test(name)) {
        scripts.push(absolute);
      }
    }
  }
}

export async function runDeploymentScripts<Context>(
  scriptPaths: readonly string[],
  context: Context,
  load: (scriptPath: string) => Promise<unknown> = loadDeploymentScript
): Promise<void> {
  for (const scriptPath of scriptPaths) {
    const module = await load(scriptPath);
    const deployment = readDefaultExport<Context>(module);
    if (deployment === undefined) {
      throw new SunhatDeploymentError(
        'INVALID_DEPLOYMENT_PLAN',
        `deployment script must default-export an async function: ${scriptPath}`
      );
    }
    await deployment(context);
  }
}

async function loadDeploymentScript(scriptPath: string): Promise<unknown> {
  const stats = await lstat(scriptPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    unsafe(`deployment script is not a regular file: ${scriptPath}`);
  }
  const url = pathToFileURL(await realpath(scriptPath));
  url.searchParams.set('sunhat', sha256(await readFile(scriptPath)).slice(0, 16));
  return import(url.href);
}

function readDefaultExport<Context>(
  value: unknown
): DeploymentScript<Context> | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const candidate = (value as { default?: unknown }).default;
  return typeof candidate === 'function'
    ? (candidate as DeploymentScript<Context>)
    : undefined;
}

function assertWithin(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    unsafe(`deployment script path escapes its root: ${candidate}`);
  }
}

function unsafe(message: string): never {
  throw new SunhatDeploymentError('UNSAFE_ARCHIVE_PATH', message);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
