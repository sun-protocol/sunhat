import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function extractArchive(
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
