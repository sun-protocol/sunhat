#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { runSunhatCli } from './main.js';

interface PackageManifest {
  readonly version?: unknown;
}

async function main(): Promise<void> {
  const manifest = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8')
  ) as PackageManifest;
  if (typeof manifest.version !== 'string') {
    throw new Error('Sunhat package manifest does not contain a version');
  }
  process.exitCode = await runSunhatCli({
    argv: process.argv.slice(2),
    currentVersion: manifest.version,
    cwd: process.cwd(),
  });
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sunhat: ${message}\n`);
  process.exitCode = 1;
}
