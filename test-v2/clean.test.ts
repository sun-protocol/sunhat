import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  cleanSunhatProject,
  SunhatCleanError,
} from '../src/v2/clean/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe('Sunhat clean task', () => {
  it('removes only reproducible outputs and preserves recovery evidence', async () => {
    const root = await temporaryDirectory('sunhat-clean-project-');
    await Promise.all([
      writeFixture(root, 'artifacts/sunhat/evm/Counter.json', '{}'),
      writeFixture(root, 'cache/sunhat/evm/cache.json', '{}'),
      writeFixture(root, 'artifacts/foreign/keep.txt', 'foreign'),
      writeFixture(root, 'cache/foreign/keep.txt', 'foreign'),
      writeFixture(root, 'build-snapshots/evm/build/manifest.json', '{}'),
      writeFixture(root, 'deployments/.sunhat/attempts/attempt.json', '{}'),
      writeFixture(root, 'verification/network/address/manifest.json', '{}'),
    ]);

    const result = await cleanSunhatProject(root);

    assert.deepEqual(result.removed, ['artifacts/sunhat', 'cache/sunhat']);
    assert.deepEqual(result.preserved, [
      'build-snapshots',
      'deployments',
      'verification',
    ]);
    assert.equal(await exists(path.join(root, 'artifacts', 'sunhat')), false);
    assert.equal(await exists(path.join(root, 'cache', 'sunhat')), false);
    assert.equal(
      await readFile(path.join(root, 'artifacts', 'foreign', 'keep.txt'), 'utf8'),
      'foreign'
    );
    assert.equal(
      await readFile(
        path.join(root, 'build-snapshots', 'evm', 'build', 'manifest.json'),
        'utf8'
      ),
      '{}'
    );
    assert.equal(
      await readFile(
        path.join(root, 'deployments', '.sunhat', 'attempts', 'attempt.json'),
        'utf8'
      ),
      '{}'
    );
    assert.equal(
      await readFile(
        path.join(root, 'verification', 'network', 'address', 'manifest.json'),
        'utf8'
      ),
      '{}'
    );
  });

  it('is idempotent when Sunhat outputs do not exist', async () => {
    const root = await temporaryDirectory('sunhat-clean-empty-');

    const first = await cleanSunhatProject(root);
    const second = await cleanSunhatProject(root);

    assert.deepEqual(first.removed, []);
    assert.deepEqual(second.removed, []);
  });

  it('rejects a parent symlink without touching its external target', async () => {
    const root = await temporaryDirectory('sunhat-clean-project-');
    const external = await temporaryDirectory('sunhat-clean-external-');
    await writeFixture(external, 'sunhat/sentinel.txt', 'preserve');
    await symlink(external, path.join(root, 'artifacts'));

    await assert.rejects(
      () => cleanSunhatProject(root),
      (error: unknown) => {
        assert.ok(error instanceof SunhatCleanError);
        assert.equal(error.code, 'CLEAN_PATH_UNSAFE');
        return true;
      }
    );
    assert.equal(
      await readFile(path.join(external, 'sunhat', 'sentinel.txt'), 'utf8'),
      'preserve'
    );
  });

  it('validates every clean path before removing any output', async () => {
    const root = await temporaryDirectory('sunhat-clean-project-');
    const external = await temporaryDirectory('sunhat-clean-external-');
    await writeFixture(root, 'artifacts/sunhat/keep-on-error.txt', 'preserve');
    await writeFixture(external, 'sunhat/sentinel.txt', 'preserve');
    await symlink(external, path.join(root, 'cache'));

    await assert.rejects(
      () => cleanSunhatProject(root),
      (error: unknown) => {
        assert.ok(error instanceof SunhatCleanError);
        assert.equal(error.code, 'CLEAN_PATH_UNSAFE');
        return true;
      }
    );
    assert.equal(
      await readFile(
        path.join(root, 'artifacts', 'sunhat', 'keep-on-error.txt'),
        'utf8'
      ),
      'preserve'
    );
    assert.equal(
      await readFile(path.join(external, 'sunhat', 'sentinel.txt'), 'utf8'),
      'preserve'
    );
  });

  it('rejects an unexpected file in a clean path component', async () => {
    const root = await temporaryDirectory('sunhat-clean-file-');
    await writeFile(path.join(root, 'artifacts'), 'not-a-directory');

    await assert.rejects(
      () => cleanSunhatProject(root),
      (error: unknown) => {
        assert.ok(error instanceof SunhatCleanError);
        assert.equal(error.code, 'CLEAN_PATH_UNEXPECTED_TYPE');
        return true;
      }
    );
  });
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeFixture(
  root: string,
  relativePath: string,
  content: string
): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
