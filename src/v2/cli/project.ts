import { createRequire } from 'module';
import path from 'path';
import { access, readFile, readdir, realpath, stat } from 'fs/promises';
import { constants } from 'fs';
import { SunhatCliError } from './errors.js';

const DEFAULT_CONFIG_NAMES = [
  'hardhat.config.ts',
  'hardhat.config.js',
  'hardhat.config.mjs',
] as const;

export interface ProjectLocation {
  readonly configPath: string;
  readonly projectRoot: string;
}

export interface ProjectRuntime {
  readonly cliPath: string;
  readonly hardhatCliPath: string;
  readonly hardhatVersion: string;
  readonly packageRoot: string;
  readonly sunhatVersion: string;
}

export async function locateProject(
  startDirectory: string,
  explicitConfig?: string
): Promise<ProjectLocation> {
  const startingPoint = path.resolve(startDirectory);
  if (explicitConfig !== undefined) {
    const configPath = path.resolve(startingPoint, explicitConfig);
    await assertReadableFile(configPath, `config file "${explicitConfig}" was not found`);
    return Object.freeze({ configPath, projectRoot: path.dirname(configPath) });
  }

  let currentDirectory = startingPoint;
  while (true) {
    const entries = new Set(await readdir(currentDirectory));
    const matches = DEFAULT_CONFIG_NAMES.filter((name) => entries.has(name));
    if (matches.length > 1) {
      throw new SunhatCliError(
        'AMBIGUOUS_CONFIG',
        `multiple Hardhat config files found in ${currentDirectory}: ${matches.join(', ')}`
      );
    }
    if (matches.length === 1) {
      const configPath = path.join(currentDirectory, matches[0]);
      await assertReadableFile(configPath, `config file "${configPath}" is not readable`);
      return Object.freeze({
        configPath,
        projectRoot: currentDirectory,
      });
    }
    const parent = path.dirname(currentDirectory);
    if (parent === currentDirectory) {
      throw new SunhatCliError(
        'PROJECT_NOT_FOUND',
        `no Hardhat config found from ${startingPoint} to the filesystem root`
      );
    }
    currentDirectory = parent;
  }
}

export function readConfigArgument(argv: readonly string[]): string | undefined {
  let configPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      break;
    }
    if (argument === '--config') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new SunhatCliError(
          'CONFIG_ARGUMENT_INVALID',
          '--config requires a path argument'
        );
      }
      if (configPath !== undefined) {
        throw new SunhatCliError(
          'CONFIG_ARGUMENT_INVALID',
          '--config may only be specified once'
        );
      }
      configPath = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--config=')) {
      const value = argument.slice('--config='.length);
      if (value === '' || configPath !== undefined) {
        throw new SunhatCliError(
          'CONFIG_ARGUMENT_INVALID',
          '--config requires one non-empty path argument'
        );
      }
      configPath = value;
    }
  }
  return configPath;
}

export async function resolveProjectRuntime(
  projectRoot: string
): Promise<ProjectRuntime> {
  const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));
  const sunhatManifestPath = resolveManifest(
    requireFromProject,
    '@sun-protocol/sunhat/package.json',
    '@sun-protocol/sunhat'
  );
  const hardhatManifestPath = resolveManifest(
    requireFromProject,
    'hardhat/package.json',
    'hardhat'
  );
  const [sunhatManifest, hardhatManifest] = await Promise.all([
    readManifest(sunhatManifestPath),
    readManifest(hardhatManifestPath),
  ]);
  if (sunhatManifest.name !== '@sun-protocol/sunhat') {
    throw new SunhatCliError(
      'INVALID_LOCAL_PACKAGE',
      `resolved package is ${String(sunhatManifest.name)}, expected @sun-protocol/sunhat`
    );
  }
  if (hardhatManifest.name !== 'hardhat') {
    throw new SunhatCliError(
      'INVALID_LOCAL_PACKAGE',
      `resolved package is ${String(hardhatManifest.name)}, expected hardhat`
    );
  }

  const packageRoot = path.dirname(sunhatManifestPath);
  const hardhatPackageRoot = path.dirname(hardhatManifestPath);
  const cliRelativePath = readPackageBin(
    sunhatManifest.bin,
    'sunhat',
    '@sun-protocol/sunhat'
  );
  const hardhatCliRelativePath = readPackageBin(
    hardhatManifest.bin,
    'hardhat',
    'hardhat'
  );
  const cliPath = path.resolve(packageRoot, cliRelativePath);
  const hardhatCliPath = path.resolve(
    hardhatPackageRoot,
    hardhatCliRelativePath
  );
  const [
    realPackageRoot,
    realCliPath,
    realHardhatPackageRoot,
    realHardhatCliPath,
  ] = await Promise.all([
    realpath(packageRoot),
    realpath(cliPath),
    realpath(hardhatPackageRoot),
    realpath(hardhatCliPath),
  ]);
  if (!isInside(realPackageRoot, realCliPath)) {
    throw new SunhatCliError(
      'INVALID_LOCAL_PACKAGE',
      'the local sunhat executable resolves outside its package directory'
    );
  }
  if (!isInside(realHardhatPackageRoot, realHardhatCliPath)) {
    throw new SunhatCliError(
      'INVALID_LOCAL_PACKAGE',
      'the local hardhat executable resolves outside its package directory'
    );
  }

  const sunhatVersion = readVersion(sunhatManifest.version, '@sun-protocol/sunhat');
  const hardhatVersion = readVersion(hardhatManifest.version, 'hardhat');
  assertRuntimeCompatibility({
    hardhatVersion,
    nodeVersion: process.versions.node,
    sunhatVersion,
  });

  return Object.freeze({
    cliPath: realCliPath,
    hardhatCliPath: realHardhatCliPath,
    hardhatVersion,
    packageRoot: realPackageRoot,
    sunhatVersion,
  });
}

export function assertRuntimeCompatibility(versions: {
  readonly hardhatVersion: string;
  readonly nodeVersion: string;
  readonly sunhatVersion: string;
}): void {
  const node = parseVersion(versions.nodeVersion, 'Node.js');
  if (compareVersion(node, [22, 13, 0]) < 0) {
    throw new SunhatCliError(
      'INCOMPATIBLE_NODE',
      `Node.js ${versions.nodeVersion} is unsupported; Sunhat 2.x requires >=22.13.0`
    );
  }
  const sunhat = parseVersion(versions.sunhatVersion, '@sun-protocol/sunhat');
  if (sunhat[0] !== 2) {
    throw new SunhatCliError(
      'INCOMPATIBLE_SUNHAT',
      `local @sun-protocol/sunhat ${versions.sunhatVersion} is unsupported; expected 2.x`
    );
  }
  const hardhat = parseVersion(versions.hardhatVersion, 'hardhat');
  if (compareVersion(hardhat, [3, 15, 0]) < 0 || hardhat[0] >= 4) {
    throw new SunhatCliError(
      'INCOMPATIBLE_HARDHAT',
      `local hardhat ${versions.hardhatVersion} is unsupported; expected >=3.15.0 <4`
    );
  }
}

async function assertReadableFile(filePath: string, message: string): Promise<void> {
  try {
    await access(filePath, constants.R_OK);
    if (!(await stat(filePath)).isFile()) {
      throw new Error('not a file');
    }
  } catch {
    throw new SunhatCliError('PROJECT_NOT_FOUND', message);
  }
}

function resolveManifest(
  requireFromProject: ReturnType<typeof createRequire>,
  request: string,
  dependencyName: string
): string {
  try {
    return requireFromProject.resolve(request);
  } catch {
    throw new SunhatCliError(
      'LOCAL_DEPENDENCY_MISSING',
      `project-local ${dependencyName} is required; install it in the project or workspace`
    );
  }
}

async function readManifest(manifestPath: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('manifest is not an object');
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new SunhatCliError(
      'INVALID_LOCAL_PACKAGE',
      `cannot read package manifest ${manifestPath}: ${formatError(error)}`
    );
  }
}

function readPackageBin(
  value: unknown,
  commandName: string,
  dependencyName: string
): string {
  let binPath: unknown;
  if (typeof value === 'string') {
    binPath = value;
  } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    binPath = (value as Record<string, unknown>)[commandName];
  }
  if (typeof binPath !== 'string' || binPath.trim() === '') {
    throw new SunhatCliError(
      'INVALID_LOCAL_PACKAGE',
      `local ${dependencyName} does not declare bin.${commandName}`
    );
  }
  return binPath;
}

function readVersion(value: unknown, dependencyName: string): string {
  if (typeof value !== 'string') {
    throw new SunhatCliError(
      'INVALID_LOCAL_PACKAGE',
      `${dependencyName} package manifest does not contain a version`
    );
  }
  return value;
}

function parseVersion(value: string, dependencyName: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value);
  if (match === null) {
    throw new SunhatCliError(
      'INVALID_LOCAL_PACKAGE',
      `${dependencyName} version "${value}" is invalid`
    );
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(
  left: readonly number[],
  right: readonly number[]
): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return 0;
}

function isInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
