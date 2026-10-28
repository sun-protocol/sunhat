import assert from 'node:assert/strict';
import test from 'node:test';
import { parseToml } from '../dist/project/toml.js';

test('TOML parsing does not require or validate a project binding', () => {
  const document = parseToml("name = 'example'\nenabled = true");
  assert.equal(document.name, 'example');
  assert.equal(document.enabled, true);
  const unbound = parseToml('[project]\nframework = 42\ntarget = false');
  assert.equal(unbound.project.framework, 42n);
  assert.equal(unbound.project.target, false);
});

test('TOML 1.0 strings, dotted keys, tables, and arrays are parsed by the backend', () => {
  const document = parseToml(`title = """
first
second"""
project.framework = 'hardhat'
project.target = "evm" # target
metadata = { enabled = true, labels = ["one", "two"] }
[[servers]]
name = "local"
`);
  assert.equal(document.title, 'first\nsecond');
  assert.equal(document.project.framework, 'hardhat');
  assert.equal(document.project.target, 'evm');
  assert.equal(document.metadata.enabled, true);
  assert.deepEqual(document.metadata.labels, ['one', 'two']);
  assert.equal(document.servers[0].name, 'local');
});

test('TOML signed 64-bit integers are preserved without precision loss', () => {
  const document = parseToml(
    'minimum = -9223372036854775808\nmaximum = 9223372036854775807',
  );
  assert.equal(document.minimum, -9223372036854775808n);
  assert.equal(document.maximum, 9223372036854775807n);
});

test('TOML date parsing works without a Temporal global', () => {
  const document = parseToml('created = 1979-05-27T07:32:00Z');
  assert.ok(document.created instanceof Date);
  assert.equal(document.created.toISOString(), '1979-05-27T07:32:00.000Z');
});

for (const [name, text] of [
  ['duplicate keys', 'key = "one"\nkey = "two"'],
  ['duplicate tables', '[metadata]\n[metadata]'],
  ['missing values', 'key ='],
  ['unterminated strings', 'key = "unterminated'],
]) {
  test(`TOML parsing rejects ${name} without Binding validation`, () => {
    assert.throws(() => parseToml(text));
  });
}
