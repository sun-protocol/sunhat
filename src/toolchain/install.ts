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
import {
  CliError,
  errorMessage,
  hasErrorCode,
  toolchainError,
} from '../errors.js';
import type { Target } from '../project/binding.js';
import type { ToolchainLock } from './lock.js';
import { platformKey, releaseFor, releaseUrl } from './releases.js';

const execFileAsync = promisify(execFile);

interface InstallOptions {
  readonly download?: (url: string) => Promise<Buffer>;
  readonly extract?: (archive: string, destination: string) => Promise<void>;
  readonly downloadIdleTimeoutMs?: number;
}

export async function installFoundry(
  root: string,
  target: Target,
  options: InstallOptions = {},
): Promise<number> {
  const {
    downloadIdleTimeoutMs = 60_000,
    download = (url) => downloadArchive(url, downloadIdleTimeoutMs),
    extract = extractArchive,
  } = options;
  const release = releaseFor(target, root);
  const url = releaseUrl(release);
  process.stderr.write('verify\n');
  const bytes = await download(url);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== release.sha256) {
    return toolchainError('archive digest mismatch');
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
    await extract(archive, extracted);
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
    } satisfies ToolchainLock;
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
    process.stderr.write('Toolchain installed successfully.\n');
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

async function downloadArchive(
  url: string,
  idleTimeoutMs: number,
): Promise<Buffer> {
  const controller = new AbortController();
  const { signal } = controller;
  const timeout = setTimeout(() => controller.abort(), idleTimeoutMs);
  timeout.unref();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, { redirect: 'follow', signal });
    timeout.refresh();
    if (!response.ok) {
      return toolchainError(`download failed (${response.status})`);
    }
    if (!response.body) {
      return toolchainError('download returned an empty response');
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      received += value.byteLength;
      timeout.refresh();
    }
    return Buffer.concat(chunks, received);
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    const detail =
      error instanceof Error && error.cause
        ? `${errorMessage(error)}: ${errorMessage(error.cause)}`
        : errorMessage(error);
    return toolchainError(
      signal.aborted
        ? `download timed out after ${idleTimeoutMs / 1_000}s without data`
        : `download failed: ${detail}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
    // Abort any unread error response so its connection cannot keep the CLI alive.
    controller.abort();
    reader?.releaseLock();
  }
}

async function extractArchive(
  archive: string,
  destination: string,
): Promise<void> {
  if (archive.endsWith('.zip')) {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${destination.replaceAll("'", "''")}'`,
    ]);
  } else {
    await execFileAsync('tar', ['-xzf', archive, '-C', destination]);
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
