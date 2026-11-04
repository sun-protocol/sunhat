import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { compatibility, readCompatibility } from '../dist/compatibility.js';
import { isCompatibleDependency } from '../dist/versions.js';

test('invalid compatibility metadata fails before it can change a runtime guard', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sunhat-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'compatibility.json');
  for (const mutate of [
    () => null,
    () => [],
    (value) => {
      value.node.majors.push(26);
      return value;
    },
    (value) => {
      value.node.majors[0] = 21;
      return value;
    },
    (value) => {
      value.node.minimum.cli.major = 18;
      return value;
    },
    (value) => {
      value.node.tested[1] = '22.12.0';
      return value;
    },
    (value) => {
      value.node.tooling = '28.0.0';
      return value;
    },
    (value) => {
      value.hardhat3Tron.hardhat.tested = '4.0.0';
      return value;
    },
    (value) => {
      value.hardhat3Tron.ethers.entry = 'another-package';
      return value;
    },
  ]) {
    writeFileSync(path, JSON.stringify(mutate(structuredClone(compatibility))));
    assert.throws(
      () => readCompatibility(path),
      (error) => error.message.includes(path),
    );
  }
  writeFileSync(path, '{');
  assert.throws(
    () => readCompatibility(path),
    (error) => error.cause instanceof SyntaxError,
  );
});

test('dependency minima preserve stable-major and pre-1.0 minor boundaries', () => {
  for (const [actual, minimum, expected] of [
    ['3.21.1', '3.21.1', true],
    ['3.22.0', '3.21.1', true],
    ['3.21.0', '3.21.1', false],
    ['4.0.0', '3.21.1', false],
    ['0.1.1', '0.1.0', true],
    ['0.2.0', '0.1.0', false],
    ['3.21.1-beta.1', '3.21.1', false],
    ['3.21', '3.21.1', false],
  ]) {
    assert.equal(isCompatibleDependency(actual, minimum), expected);
  }
});

test(
  'jar build validates default image fields before Docker and honors explicit overrides',
  { skip: process.platform === 'win32' },
  (t) => {
    const root = mkdtempSync(join(tmpdir(), 'sunhat-image-policy-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'config'));
    mkdirSync(join(root, 'bin'));
    const script = join(root, 'scripts/build-tre-jar.sh');
    copyFileSync(
      new URL('../scripts/build-tre-jar.sh', import.meta.url),
      script,
    );
    const marker = join(root, 'docker-called');
    writeFileSync(
      join(root, 'bin/docker'),
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$SUNHAT_DOCKER_MARKER"\nexit 77\n',
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${join(root, 'bin')}:${process.env.PATH}`,
      SUNHAT_DOCKER_MARKER: marker,
    };
    delete env.TRE_IMAGE;
    delete env.JDK_IMAGE;
    delete env.TRE_JAR;
    for (const value of [
      null,
      [],
      { image: 42 },
      { image: 'test/tre', jdkImage: null },
    ]) {
      writeFileSync(
        join(root, 'config/tron-defaults.json'),
        JSON.stringify(value),
      );
      const result = spawnSync('bash', [script], {
        env,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /Invalid TRON default .*config\/tron-defaults.json/,
      );
      assert.equal(existsSync(marker), false);
    }
    const result = spawnSync('bash', [script], {
      env: {
        ...env,
        TRE_IMAGE: 'custom/tre:fixed',
        JDK_IMAGE: 'custom/jdk:fixed',
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 77);
    assert.match(readFileSync(marker, 'utf8'), /custom\/tre:fixed/);
  },
);
