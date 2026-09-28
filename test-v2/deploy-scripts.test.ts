import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  discoverDeploymentScripts,
  runDeploymentScripts,
  SunhatDeploymentError,
} from '../src/v2/deploy/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe('Sunhat P4 deployment scripts', () => {
  it('discovers nested ESM scripts in deterministic path order', async () => {
    const root = await fixture();
    await mkdir(path.join(root, 'deploy', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'deploy', '020_second.ts'), 'export default 1;\n');
    await writeFile(path.join(root, 'deploy', 'nested', '010_first.mjs'), 'export default 1;\n');
    await writeFile(path.join(root, 'deploy', 'README.md'), 'ignored\n');

    const scripts = await discoverDeploymentScripts(root);
    const canonicalRoot = await realpath(root);
    assert.deepEqual(
      scripts.map((script) => path.relative(canonicalRoot, script)),
      ['deploy/020_second.ts', 'deploy/nested/010_first.mjs']
    );
  });

  it('rejects symbolic links before loading deployment code', async () => {
    const root = await fixture();
    const outside = path.join(root, 'outside.ts');
    await writeFile(outside, 'export default async function () {}\n');
    await symlink(outside, path.join(root, 'deploy', 'linked.ts'));

    await assert.rejects(
      () => discoverDeploymentScripts(root),
      deploymentError('UNSAFE_ARCHIVE_PATH')
    );
  });

  it('runs each validated default export sequentially', async () => {
    const calls: string[] = [];
    const paths = ['/project/002.ts', '/project/001.ts'];
    await runDeploymentScripts(paths, calls, async (scriptPath) => ({
      default: async (context: string[]) => {
        context.push(path.basename(scriptPath));
      },
    }));

    assert.deepEqual(calls, ['002.ts', '001.ts']);
  });
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sunhat-p4-scripts-'));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, 'deploy'));
  return root;
}

function deploymentError(code: SunhatDeploymentError['code']) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof SunhatDeploymentError);
    assert.equal(error.code, code);
    return true;
  };
}
