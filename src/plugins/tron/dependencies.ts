import { isCompatibleDependency } from '../../versions.js';
import { createRequire } from 'node:module';
import { dirname, parse, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { isRecord, readJson } from '../../json.js';

const require = createRequire(import.meta.url);
export function assertDependency(
  name: string,
  minimum: string,
  entry = name,
): void {
  let directory = dirname(require.resolve(entry));
  while (true) {
    const path = resolve(directory, 'package.json');
    if (existsSync(path)) {
      const metadata = readJson(path);
      if (isRecord(metadata) && metadata.name === name) {
        const version =
          typeof metadata.version === 'string' ? metadata.version : '';
        if (isCompatibleDependency(version, minimum)) {
          return;
        }
        throw new Error(
          `Sunhat TRON requires ${name} ${minimum} or newer within that major; resolved ${version || 'unknown'} at ${path}`,
        );
      }
    }
    if (directory === parse(directory).root) {
      break;
    }
    directory = dirname(directory);
  }
  throw new Error(
    `Cannot locate package metadata for required TRON dependency ${name}`,
  );
}
