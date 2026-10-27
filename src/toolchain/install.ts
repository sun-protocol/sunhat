import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { errorMessage, hasErrorCode, toolchainError } from '../errors.js';
import type { Target } from '../project/binding.js';
import { platformKey, releaseFor, releaseUrl } from './releases.js';

const execFileAsync = promisify(execFile);

export async function installFoundry(
  root: string,
  target: Target,
): Promise<number> {
  const release = releaseFor(target, root);
  const url = releaseUrl(release);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    return toolchainError(`download failed (${response.status}): ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== release.sha256) {
    return toolchainError(
      `archive digest mismatch: expected ${release.sha256}, got ${digest}`,
    );
  }

  const toolchains = resolve(root, '.sunhat/toolchains');
  mkdirSync(toolchains, { recursive: true });
  // Stage beside the destination so every binary/directory rename stays on its filesystem.
  const temporary = mkdtempSync(resolve(toolchains, `.install-${target}-`));
  let lockTemporary: string | undefined;
  let preserveBackup = false;
  try {
    const archive = resolve(temporary, release.archive);
    const extracted = resolve(temporary, 'extracted');
    mkdirSync(extracted);
    writeFileSync(archive, bytes);
    if (release.archive.endsWith('.zip')) {
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${extracted.replaceAll("'", "''")}'`,
      ]);
    } else {
      await execFileAsync('tar', ['-xzf', archive, '-C', extracted]);
    }
    const prepared = resolve(temporary, 'binaries');
    mkdirSync(prepared);
    const binaries: Record<string, { path: string }> = {};
    for (const [tool, filename] of Object.entries(release.tools)) {
      const source = resolve(extracted, filename);
      const output = resolve(prepared, filename);
      renameSync(source, output);
      chmodSync(output, 0o755);
      binaries[tool] = {
        path: `.sunhat/toolchains/${target}/${filename}`,
      };
    }
    const lock = {
      version: 2,
      target,
      source: release.source,
      release: release.release,
      revision: release.revision,
      platform: platformKey(),
      binaries,
    };
    // The lock may live on a different mount from toolchains; stage beside it too.
    lockTemporary = mkdtempSync(resolve(root, '.sunhat/.toolchain-lock-'));
    const preparedLock = resolve(lockTemporary, 'toolchain.json');
    writeFileSync(preparedLock, `${JSON.stringify(lock, null, 2)}\n`, {
      flag: 'wx',
    });

    const destination = resolve(toolchains, target);
    const backup = resolve(temporary, 'previous');
    let backedUp = false;
    let activated = false;
    try {
      renameSync(destination, backup);
      backedUp = true;
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) {
        throw error;
      }
    }
    try {
      renameSync(prepared, destination);
      activated = true;
      renameSync(preparedLock, resolve(root, '.sunhat/toolchain.json'));
    } catch (error) {
      try {
        if (activated) {
          rmSync(destination, { recursive: true, force: true });
        }
        if (backedUp) {
          renameSync(backup, destination);
        }
      } catch (rollbackError) {
        // Never remove the only remaining copy when restoring the old directory fails.
        preserveBackup = backedUp;
        return toolchainError(
          `installation failed: ${errorMessage(error)}; rollback failed: ${errorMessage(rollbackError)}${backedUp ? `; previous toolchain preserved at ${backup}` : ''}`,
          { cause: error },
        );
      }
      throw error;
    }
    process.stderr.write(
      `installed ${release.source}@${release.revision} from ${url}\n`,
    );
    return 0;
  } finally {
    if (!preserveBackup) {
      removeTemporaryDirectory(temporary);
    }
    if (lockTemporary) {
      removeTemporaryDirectory(lockTemporary);
    }
  }
}

function removeTemporaryDirectory(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    // Cleanup must not replace the installation result or prevent further cleanup.
    process.stderr.write(
      `warning: cannot remove temporary directory ${path}: ${errorMessage(error)}\n`,
    );
  }
}
