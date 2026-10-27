import { createRequire } from 'node:module';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { toolchainError } from '../errors.js';
import { spawnNative } from '../process/spawn.js';
interface PackageJson { version?: string; bin?: string | Record<string, string> }
export async function runHardhat(root: string, args: readonly string[]): Promise<number> {
  const require = createRequire(resolve(root, 'package.json')); let manifestPath: string;
  try { manifestPath = require.resolve('hardhat/package.json'); } catch { return toolchainError('local Hardhat dependency is missing; install the project lockfile dependencies'); }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageJson;
  if (!manifest.version?.startsWith('2.')) return toolchainError(`Hardhat 2 is required; resolved ${manifest.version ?? 'unknown'} at ${manifestPath}`);
  const project = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const expected = project.devDependencies?.hardhat ?? project.dependencies?.hardhat;
  if (!expected) return toolchainError('Hardhat must be declared in the project package.json');
  if (expected !== manifest.version) return toolchainError(`Hardhat version mismatch: expected ${expected}, resolved ${manifest.version} at ${manifestPath}`);
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.hardhat;
  if (!relative) return toolchainError(`Hardhat package has no hardhat bin entry: ${manifestPath}`);
  if (isAbsolute(relative)) return toolchainError('Hardhat bin must be package-relative');
  const packageRoot = realpathSync(dirname(manifestPath)); const entry = realpathSync(resolve(packageRoot, relative));
  if (entry !== packageRoot && !entry.startsWith(`${packageRoot}${sep}`)) return toolchainError('Hardhat bin escapes package root');
  return await spawnNative(process.execPath, [entry, ...args], root);
}
