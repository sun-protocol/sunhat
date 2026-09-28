#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(projectRoot, 'src');
const sourceExtensions = new Set(['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts']);
const forbiddenImports = [
  {
    label: 'Hardhat internal API',
    pattern: /hardhat\/(?:internal|builtin-tasks)(?:\/|['"])/,
  },
  {
    label: 'Hardhat 2 Vyper plugin',
    pattern: /@nomiclabs\/hardhat-vyper(?:\/|['"])/,
  },
];

const sourceFiles = await collectSourceFiles(sourceRoot);
const violations = [];

for (const filePath of sourceFiles) {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    for (const forbiddenImport of forbiddenImports) {
      if (forbiddenImport.pattern.test(line)) {
        violations.push(
          `${path.relative(projectRoot, filePath)}:${index + 1}: ${forbiddenImport.label}`
        );
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Public API gate passed for ${sourceFiles.length} production source files.\n`
  );
}

async function collectSourceFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`source tree contains a symbolic link: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}
