import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { CliError } from '../errors.js';

export async function spawnNative(
  executable: string,
  args: readonly string[],
  cwd: string,
): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      windowsHide: false,
    });
    const onInt = (): void => {
      child.kill('SIGINT');
    };
    const onTerm = (): void => {
      child.kill('SIGTERM');
    };
    const cleanup = (): void => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      child.off('error', onError);
      child.off('close', onClose);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(
        new CliError(
          `failed to start ${executable} in ${cwd}: ${error.message}`,
          6,
          { cause: error },
        ),
      );
    };
    const onClose = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      cleanup();
      const signalNumber =
        signal === null ? undefined : constants.signals[signal];
      resolve(code ?? (signalNumber === undefined ? 1 : 128 + signalNumber));
    };
    process.once('SIGINT', onInt);
    process.once('SIGTERM', onTerm);
    child.once('error', onError);
    child.once('close', onClose);
  });
}
