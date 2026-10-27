import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { promisify } from 'node:util';
import { usage, toolchainError } from '../errors.js';
import type { Target } from '../project/binding.js';
import { loadToolchain, sha256 } from '../adapters/foundry.js';
import { platformKey, releaseFor, releaseUrl } from '../toolchain/releases.js';

const execFileAsync = promisify(execFile);

export async function toolchain(root: string, target: Target, args: readonly string[]): Promise<number> {
  const command = args[0];
  if (!command || args.length !== 1 || !['install', 'check', 'info'].includes(command)) return usage('toolchain requires exactly one command: install, check or info');
  if (command === 'install') return await install(root, target);
  const lock = loadToolchain(root, target);
  if (command === 'check') for (const [tool, item] of Object.entries(lock.binaries)) if (sha256(resolve(root, item.path)) !== item.sha256) return toolchainError(`${tool} digest mismatch`);
  process.stdout.write(`framework=foundry\ntarget=${target}\nsource=${lock.source}\nrelease=${lock.release}\nrevision=${lock.revision}\nplatform=${lock.platform}\n`);
  return 0;
}

async function install(root: string, target: Target): Promise<number> {
  const release = releaseFor(target); const url = releaseUrl(release);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) return toolchainError(`download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer()); const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== release.sha256) return toolchainError(`archive digest mismatch: expected ${release.sha256}, got ${digest}`);

  const toolchains = resolve(root, '.sunhat/toolchains'); mkdirSync(toolchains, { recursive: true });
  // Stage beside the destination so every binary/directory rename stays on its filesystem.
  const temporary = mkdtempSync(resolve(toolchains, `.install-${target}-`));
  let lockTemporary: string | undefined;
  let preserveBackup = false;
  try {
    const archive = resolve(temporary, release.archive); const extracted = resolve(temporary, 'extracted'); mkdirSync(extracted); writeFileSync(archive, bytes);
    if (release.archive.endsWith('.zip')) await execFileAsync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${extracted.replaceAll("'", "''")}'`]);
    else await execFileAsync('tar', ['-xzf', archive, '-C', extracted]);
    const prepared = resolve(temporary, 'binaries'); mkdirSync(prepared);
    const binaries: Record<string, { path: string; sha256: string }> = {};
    for (const [tool, filename] of Object.entries(release.tools)) {
      const source = resolve(extracted, filename); const output = resolve(prepared, basename(filename)); renameSync(source, output); chmodSync(output, 0o755);
      binaries[tool] = { path: `.sunhat/toolchains/${target}/${basename(filename)}`, sha256: sha256(output) };
    }
    const lock = { version: 1, target, source: release.source, release: release.release, revision: release.revision, platform: platformKey(), binaries };
    // The lock may live on a different mount from toolchains; stage beside it too.
    lockTemporary = mkdtempSync(resolve(root, '.sunhat/.toolchain-lock-'));
    const preparedLock = resolve(lockTemporary, 'toolchain.json');
    writeFileSync(preparedLock, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx' });

    const destination = resolve(toolchains, target); const backup = resolve(temporary, 'previous');
    let backedUp = false; let activated = false;
    try { renameSync(destination, backup); backedUp = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try {
      renameSync(prepared, destination); activated = true;
      renameSync(preparedLock, resolve(root, '.sunhat/toolchain.json'));
    } catch (error) {
      try {
        if (activated) rmSync(destination, { recursive: true, force: true });
        if (backedUp) renameSync(backup, destination);
      } catch (rollbackError) {
        // Never remove the only remaining copy when restoring the old directory fails.
        preserveBackup = backedUp;
        return toolchainError(`installation failed: ${errorMessage(error)}; rollback failed: ${errorMessage(rollbackError)}${backedUp ? `; previous toolchain preserved at ${backup}` : ''}`);
      }
      throw error;
    }
    process.stderr.write(`installed ${release.source}@${release.revision} from ${url}\n`); return 0;
  } finally {
    if (!preserveBackup) rmSync(temporary, { recursive: true, force: true });
    if (lockTemporary) rmSync(lockTemporary, { recursive: true, force: true });
  }
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
