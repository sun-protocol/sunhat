import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' },
);
const chinese = /\p{Script=Han}/u;
const failures = [];
for (const name of new Set(names.split('\0').filter(Boolean))) {
  if (chinese.test(name)) {
    failures.push(`${name}: Chinese characters in path`);
  }
  const path = resolve(root, name);
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    continue;
  }
  const bytes = readFileSync(path);
  if (bytes.includes(0)) {
    continue;
  }
  const lines = bytes.toString('utf8').split('\n');
  for (const [index, line] of lines.entries()) {
    if (chinese.test(line)) {
      failures.push(`${name}:${index + 1}: Chinese characters in content`);
    }
  }
}
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Maintained file names and text contain no Chinese characters.');
}
