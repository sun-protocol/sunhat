import { cpSync, mkdirSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));

export function copyCliRuntime(packageRoot) {
  mkdirSync(packageRoot);
  for (const name of ['bin', 'dist', 'templates', 'package.json']) {
    cpSync(resolve(repository, name), resolve(packageRoot, name), {
      recursive: true,
    });
  }
  symlinkSync(
    resolve(repository, 'node_modules'),
    resolve(packageRoot, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return { packageRoot, cli: resolve(packageRoot, 'bin/sunhat.js') };
}
