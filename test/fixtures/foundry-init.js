import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after } from 'node:test';
import { setArchiveDigest } from './toolchain-config.js';

const temporary = mkdtempSync(resolve(tmpdir(), 'sunhat-init-archive-'));
after(() => rmSync(temporary, { recursive: true, force: true }));
const source = resolve(temporary, 'source');
mkdirSync(source);
const windows = process.platform === 'win32';
const archive = resolve(temporary, windows ? 'tools.zip' : 'tools.tar.gz');
const files = [];
for (const tool of ['forge', 'cast', 'anvil', 'chisel']) {
  for (const suffix of ['', '-tron']) {
    const filename = `${tool}${suffix}${windows ? '.exe' : ''}`;
    writeFileSync(
      resolve(source, filename),
      `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`,
    );
    files.push(filename);
  }
}
if (windows) {
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath @(${files.map((name) => literal(resolve(source, name))).join(', ')}) -DestinationPath ${literal(archive)}`,
    ],
    { timeout: 30_000 },
  );
} else {
  execFileSync('tar', ['-czf', archive, '-C', source, ...files], {
    timeout: 30_000,
  });
}

export const foundryInitArgs = [
  '--import',
  new URL('./toolchain-install-download.js', import.meta.url).href,
];
export const foundryInitEnv = { SUNHAT_TEST_ARCHIVE: archive };

export function configureFoundryTemplates(packageRoot) {
  for (const target of ['evm', 'tron']) {
    setArchiveDigest(
      resolve(
        packageRoot,
        'templates/foundry',
        target,
        'foundry-toolchain.json',
      ),
      archive,
    );
  }
}
