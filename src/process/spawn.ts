import { spawn } from 'node:child_process';
import { CliError } from '../errors.js';
export async function spawnNative(executable: string, args: readonly string[], cwd: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: 'inherit', shell: false, windowsHide: false });
    const onInt = (): void => { child.kill('SIGINT'); }; const onTerm = (): void => { child.kill('SIGTERM'); };
    process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
    child.once('error', error => reject(new CliError(`failed to start ${executable}: ${error.message}`, 6)));
    child.once('exit', (code, signal) => { process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)); });
  });
}
