import { existsSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { CliError } from '../errors.js';

export function findProjectRoot(start: string): string {
  let current = resolve(start);
  const filesystemRoot = parse(current).root;
  for (;;) {
    if (existsSync(resolve(current, 'sunhat.toml'))) {
      return current;
    }
    if (current === filesystemRoot) {
      break;
    }
    current = dirname(current);
  }
  throw new CliError(
    'sunhat.toml not found; initialize with `sunhat init` or adopt with `sunhat init --adopt`',
    4,
  );
}
