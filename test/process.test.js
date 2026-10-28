import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { CliError } from '../dist/errors.js';
import { spawnNative } from '../dist/process.js';

function temporary(t) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'sunhat-process-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function listeners() {
  return ['SIGINT', 'SIGTERM'].map((signal) => process.listeners(signal));
}

test('native execution preserves literal arguments, cwd, exit status, and existing listeners', async (t) => {
  const root = temporary(t);
  const log = resolve(root, 'arguments.json');
  const handler = () => {};
  process.on('SIGINT', handler);
  t.after(() => process.off('SIGINT', handler));
  const before = listeners();
  const args = ['space value', '$HOME', '$(literal)', 'a;b', '', '--literal'];
  const program = `require('node:fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(1), cwd: process.cwd() })); process.exitCode = 23;`;
  assert.equal(
    await spawnNative(process.execPath, ['-e', program, '--', ...args], root),
    23,
  );
  assert.deepEqual(JSON.parse(readFileSync(log)), { args, cwd: root });
  assert.deepEqual(listeners(), before);
});

test('repeated startup failures remove signal listeners and retain the original error', async (t) => {
  const root = temporary(t);
  const missing = resolve(root, 'missing-executable');
  const before = listeners();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(spawnNative(missing, [], root), (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.exitCode, 6);
      assert.equal(error.cause.code, 'ENOENT');
      assert.ok(error.message.includes(missing));
      return true;
    });
    assert.deepEqual(listeners(), before);
  }
});

test('a missing working directory fails without retaining signal handlers', async (t) => {
  const root = temporary(t);
  const missing = resolve(root, 'missing-directory');
  const before = listeners();
  await assert.rejects(
    spawnNative(process.execPath, ['-e', ''], missing),
    (error) => {
      assert.equal(error.exitCode, 6);
      assert.equal(error.cause.code, 'ENOENT');
      assert.ok(error.message.includes(missing));
      return true;
    },
  );
  assert.deepEqual(listeners(), before);
});

test(
  'native signal termination returns the conventional signal exit code',
  { skip: process.platform === 'win32' },
  async () => {
    const before = listeners();
    const status = await spawnNative(
      process.execPath,
      ['-e', "process.kill(process.pid, 'SIGKILL');"],
      process.cwd(),
    );
    assert.equal(status, 128 + constants.signals.SIGKILL);
    assert.deepEqual(listeners(), before);
  },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(
    `the runner forwards ${signal} and waits for the native process`,
    { skip: process.platform === 'win32', timeout: 10_000 },
    async () => {
      const fixture = fileURLToPath(
        new URL('./fixtures/process-forwarding.js', import.meta.url),
      );
      const child = spawn(process.execPath, [fixture], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let forwarded = false;
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
        if (!forwarded && stdout.includes('ready\n')) {
          forwarded = true;
          child.kill(signal);
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      try {
        const [code, receivedSignal] = await once(child, 'close');
        assert.ok(forwarded, stderr);
        assert.equal(receivedSignal, null, stderr);
        assert.equal(code, 128 + constants.signals[signal], stderr);
        assert.ok(stdout.includes(`exit-code=${code}`), stdout);
      } finally {
        child.kill('SIGKILL');
      }
    },
  );
}
