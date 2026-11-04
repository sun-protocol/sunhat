import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { CliError } from '../dist/errors.js';
import { readBinding, validateBinding } from '../dist/project/binding.js';
import { findProjectRoot } from '../dist/project/root.js';

test('Binding validation accepts plain parsed values without a TOML parser', () => {
  for (const framework of ['hardhat', 'foundry']) {
    for (const target of ['evm', 'tron']) {
      assert.deepEqual(
        validateBinding(
          { project: { framework, target }, metadata: { value: 42n } },
          'sunhat.toml',
        ),
        { framework, target },
      );
    }
  }
});

test('binding validation accepts null-prototype tables and ignores unrelated fields', () => {
  const project = Object.assign(Object.create(null), {
    framework: 'hardhat',
    target: 'evm',
    metadata: { count: 42n, created: new Date('2026-01-01T00:00:00Z') },
  });
  const document = Object.assign(Object.create(null), {
    project,
    metadata: { enabled: true },
  });

  assert.deepEqual(validateBinding(document, 'sunhat.toml'), {
    framework: 'hardhat',
    target: 'evm',
  });
  assert.equal(document.project, project);
  assert.equal(project.metadata.count, 42n);
});

test('binding validation rejects objects with inherited project tables or fields', () => {
  for (const document of [
    Object.create({ project: { framework: 'hardhat', target: 'evm' } }),
    { project: Object.create({ framework: 'hardhat', target: 'evm' }) },
  ]) {
    assert.throws(
      () => validateBinding(document, 'sunhat.toml'),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.exitCode, 4);
        assert.match(error.message, /invalid project binding/u);
        return true;
      },
    );
  }
});

test('binding validation preserves field diagnostics without coercing values', () => {
  for (const [field, values, expected] of [
    [
      'framework',
      [undefined, null, true, 1, [], {}, '', 'Hardhat', ' hardhat', 'foundry '],
      'foundry or hardhat',
    ],
    [
      'target',
      [undefined, null, true, 1, [], {}, '', 'EVM', ' evm', 'tron '],
      'tron or evm',
    ],
  ]) {
    for (const value of values) {
      assert.throws(
        () =>
          validateBinding(
            {
              project: { framework: 'hardhat', target: 'evm', [field]: value },
            },
            'custom/sunhat.toml',
          ),
        (error) => {
          assert.ok(error instanceof CliError);
          assert.equal(error.exitCode, 4);
          assert.equal(
            error.message,
            `invalid ${field} in custom/sunhat.toml; expected ${expected}`,
          );
          return true;
        },
      );
    }
  }
});

test('Binding validation rejects malformed parsed project values', () => {
  for (const document of [
    null,
    [],
    {},
    { project: null },
    { project: [] },
    { project: new Date() },
    { project: 'hardhat' },
    { project: { framework: 42n, target: 'evm' } },
    { project: { framework: 'hardhat', target: false } },
  ]) {
    assert.throws(
      () => validateBinding(document, 'sunhat.toml'),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.exitCode, 4);
        assert.doesNotMatch(error.message, /invalid TOML/u);
        return true;
      },
    );
  }
});

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'sunhat-binding-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return resolve(root, 'sunhat.toml');
}

const valid = [
  [
    'literal strings and adjacent comments with CRLF',
    "[project]\r\nframework = 'hardhat'# framework\r\ntarget = 'evm'\r\n",
  ],
  ['dotted keys', "project.framework = 'hardhat'\nproject.target = 'evm'\n"],
  [
    'quoted keys and string escapes',
    String.raw`["project"]
"framework" = "hard\u0068at"
'target' = "evm"
`,
  ],
  [
    'inline project table and unrelated configuration',
    `project = { framework = "hardhat", target = "evm" }
[metadata]
description = "# inside a string"
features = ["one", "two"]
`,
  ],
];

for (const [name, contents] of valid) {
  test(`binding accepts TOML ${name}`, (t) => {
    const path = fixture(t);
    writeFileSync(path, contents);
    assert.deepEqual(readBinding(path), {
      framework: 'hardhat',
      target: 'evm',
    });
  });
}

const invalid = [
  [
    'duplicate keys',
    '[project]\nframework = "hardhat"\nframework = "foundry"\ntarget = "evm"\n',
    /invalid TOML/u,
  ],
  [
    'duplicate tables',
    '[project]\nframework = "hardhat"\ntarget = "evm"\n[project]\n',
    /invalid TOML/u,
  ],
  [
    'malformed syntax in another table',
    '[project]\nframework = "hardhat"\ntarget = "evm"\n[metadata]\ninvalid line\n',
    /invalid TOML/u,
  ],
  [
    'unterminated strings',
    '[project]\nframework = "hardhat"\ntarget = "evm\n',
    /invalid TOML/u,
  ],
  ['missing project table', '', /invalid project binding/u],
  ['scalar project', 'project = "hardhat"', /invalid project binding/u],
  ['array project', 'project = []', /invalid project binding/u],
  [
    'array of project tables',
    '[[project]]\nframework = "hardhat"\ntarget = "evm"',
    /invalid project binding/u,
  ],
  ['missing framework', '[project]\ntarget = "evm"', /invalid framework/u],
  [
    'unsupported framework',
    '[project]\nframework = "other"\ntarget = "evm"',
    /invalid framework/u,
  ],
  [
    'non-string framework',
    '[project]\nframework = 1\ntarget = "evm"',
    /invalid framework/u,
  ],
  ['missing target', '[project]\nframework = "hardhat"', /invalid target/u],
  [
    'unsupported target',
    '[project]\nframework = "hardhat"\ntarget = "other"',
    /invalid target/u,
  ],
  [
    'non-string target',
    '[project]\nframework = "hardhat"\ntarget = ["evm"]',
    /invalid target/u,
  ],
];

for (const [name, contents, message] of invalid) {
  test(`binding rejects ${name} with exit code 4`, (t) => {
    const path = fixture(t);
    writeFileSync(path, contents);
    assert.throws(
      () => readBinding(path),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.exitCode, 4);
        assert.match(error.message, message);
        assert.ok(error.message.includes(path));
        return true;
      },
    );
  });
}

test('binding read errors retain their path and exit code', (t) => {
  const path = fixture(t);
  assert.throws(
    () => readBinding(path),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.exitCode, 4);
      assert.match(error.message, /cannot read/u);
      assert.ok(error.message.includes(path));
      return true;
    },
  );
});

test('project discovery stops at a dangling binding instead of using the parent project', (t) => {
  const parentBinding = fixture(t);
  const parent = realpathSync(resolve(parentBinding, '..'));
  writeFileSync(
    parentBinding,
    '[project]\nframework = "hardhat"\ntarget = "evm"\n',
  );
  const project = resolve(parent, 'nested-project');
  const child = resolve(project, 'src');
  mkdirSync(child, { recursive: true });
  const binding = resolve(project, 'sunhat.toml');
  symlinkSync(resolve(parent, 'missing-binding'), binding, 'file');

  assert.equal(findProjectRoot(child), project);
  assert.throws(
    () => readBinding(binding),
    (error) => {
      assert.equal(error.exitCode, 4);
      assert.equal(error.cause.code, 'ENOENT');
      assert.ok(error.message.includes(binding));
      return true;
    },
  );
});
