import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { isSupportedNode } from '../dist/runtime.js';

const cli = fileURLToPath(new URL('../bin/sunhat.js', import.meta.url));
const fixture = new URL('./fixtures/runtime-version.js', import.meta.url).href;

for (const [version, supported] of [
  ['18.20.0', false],
  ['20.10.0', false],
  ['20.11.0', true],
  ['20.19.0', true],
  ['21.0.0', false],
  ['22.0.0', true],
  ['22.12.0', true],
  ['22.13.0', true],
  ['23.0.0', false],
  ['24.0.0', true],
  ['25.0.0', false],
  ['26.0.0', true],
  ['27.0.0', false],
  ['28.0.0', false],
  ['30.0.0', false],
  ['24.0.0-beta.1', false],
  ['22.13', false],
  ['invalid', false],
]) {
  test(`Sunhat Node support for ${version} is ${supported}`, () => {
    assert.equal(isSupportedNode(version), supported);
    const result = spawnSync(
      process.execPath,
      ['--import', fixture, cli, '--help'],
      {
        env: { ...process.env, SUNHAT_TEST_NODE_VERSION: version },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    assert.equal(result.status, supported ? 0 : 3, result.stderr);
    if (supported) {
      assert.match(result.stdout, /Sunhat project-bound framework CLI/u);
      assert.equal(result.stderr, '');
    } else {
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Sunhat requires Node.js/u);
      assert.ok(result.stderr.includes(version), result.stderr);
    }
  });
}
