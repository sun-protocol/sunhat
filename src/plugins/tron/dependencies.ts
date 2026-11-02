import { createRequire } from 'node:module';
import { dirname, parse, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { isRecord, readJson } from '../../json.js';

const require = createRequire(import.meta.url);
export function assertDependency(name: string, minimum: string): void {
  let directory = dirname(require.resolve(name));
  while (true) {
    const path = resolve(directory, 'package.json');
    if (existsSync(path)) {
      const metadata = readJson(path);
      if (isRecord(metadata) && metadata.name === name) {
        const version =
          typeof metadata.version === 'string' ? metadata.version : '';
        const actual = version
          .match(/^(\d+)\.(\d+)\.(\d+)$/u)
          ?.slice(1)
          .map(Number);
        const expected = minimum.split('.').map(Number);
        if (actual !== undefined && actual.every(Number.isSafeInteger)) {
          const [major, minor, patch] = actual;
          const [expectedMajor, expectedMinor, expectedPatch] = expected;
          if (
            major === expectedMajor &&
            minor !== undefined &&
            expectedMinor !== undefined &&
            patch !== undefined &&
            expectedPatch !== undefined &&
            (major === 0
              ? minor === expectedMinor && patch >= expectedPatch
              : minor > expectedMinor ||
                (minor === expectedMinor && patch >= expectedPatch))
          ) {
            return;
          }
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
