import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = resolve('bin/sunhat.js');
function temp(name) { return mkdtempSync(resolve(tmpdir(), `sunhat-${name}-`)); }
function run(cwd, args) { return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }); }
function json(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value)}\n`); }
function binding(root, framework, target) {
  writeFileSync(resolve(root, 'sunhat.toml'), `[project]\nframework = "${framework}"\ntarget = "${target}"\n`);
  json(resolve(root, 'package.json'), { private: true, devDependencies: framework === 'hardhat' ? { hardhat: '2.22.0' } : {} });
}
function executable(path, body) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `#!/usr/bin/env node\n${body}\n`); chmodSync(path, 0o755); }
function hardhat(root, version = '2.22.0') {
  const base = resolve(root, 'node_modules/hardhat'); json(resolve(base, 'package.json'), { name: 'hardhat', version, bin: { hardhat: 'cli.js' } });
  executable(resolve(base, 'cli.js'), `process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exitCode = 17;`);
}
function foundry(root, target) {
  const base = resolve(root, `.sunhat/toolchains/${target}`); const binaries = {};
  for (const tool of ['forge', 'cast', 'anvil', 'chisel']) { const path = resolve(base, tool); executable(path, `process.stdout.write('${tool}:'+JSON.stringify(process.argv.slice(2)));`); binaries[tool] = { path: `.sunhat/toolchains/${target}/${tool}`, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }; }
  json(resolve(root, '.sunhat/toolchain.json'), { version: 1, target, source: target === 'evm' ? 'foundry-rs/foundry' : 'elsvv/foundry-tron', release: target === 'evm' ? 'v1.8.6' : 'foundry-tron-latest', revision: target === 'evm' ? 'v1.8.6' : '9ea07db4b342fd606f6f7c3f99be1757e90d5e90', platform: 'test', binaries });
}

test('init defaults to Foundry', () => {
  const root = temp('default-foundry'); const result = run(dirname(root), ['init', '--target', 'evm', root]); assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(resolve(root, 'sunhat.toml'), 'utf8'), /framework = "foundry"/u);
  assert.match(readFileSync(resolve(root, 'foundry.toml'), 'utf8'), /\[profile\.default\]/u);
  assert.equal(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts.build, 'sunhat build');
});
test('init accepts an explicit Foundry framework', () => {
  const root = temp('explicit-foundry'); const result = run(dirname(root), ['init', '--framework', 'foundry', '--target', 'tron', root]); assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(resolve(root, 'sunhat.toml'), 'utf8'), /framework = "foundry"/u);
});
test('Hardhat scaffold requires explicit framework and refuses overwrite', () => {
  const root = temp('init'); const result = run(dirname(root), ['init', '--framework', 'hardhat', '--target', 'evm', root]); assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(resolve(root, 'sunhat.toml'), 'utf8'), /framework = "hardhat"/u);
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  assert.doesNotMatch(JSON.stringify(pkg), /hardhat-tron/u);
  assert.equal(pkg.devDependencies.sunhat, `file:${process.cwd()}`);
  assert.equal(pkg.scripts.build, 'sunhat compile');
  assert.equal(run(dirname(root), ['init', '--framework', 'hardhat', '--target', 'evm', root]).status, 2);
});
test('init rejects an invalid framework', () => { const result = run(temp('framework'), ['init', '--framework', 'unknown', '--target', 'evm']); assert.equal(result.status, 2); assert.match(result.stderr, /framework requires foundry or hardhat/u); });
test('scaffold conflict is detected before any write', () => {
  const root = temp('atomic'); mkdirSync(resolve(root, 'contracts')); writeFileSync(resolve(root, 'contracts/Counter.sol'), 'owned');
  const result = run(dirname(root), ['init', '--framework', 'hardhat', '--target', 'evm', root]); assert.equal(result.status, 2);
  assert.equal(readFileSync(resolve(root, 'contracts/Counter.sol'), 'utf8'), 'owned'); assert.throws(() => readFileSync(resolve(root, 'package.json')));
});
test('foundry scaffold does not reference unpublished placeholder packages', () => {
  const root = temp('foundry-init'); const result = run(dirname(root), ['init', '--target', 'tron', root]); assert.equal(result.status, 0, result.stderr);
  const pkg = readFileSync(resolve(root, 'package.json'), 'utf8'); assert.doesNotMatch(pkg, /@sunhat\/foundry-tron-toolchain/u); assert.match(pkg, /elsvv\/foundry-tron/u);
  assert.doesNotMatch(readFileSync(resolve(root, 'script/Counter.s.sol'), 'utf8'), /forge-std/u);
  assert.doesNotMatch(readFileSync(resolve(root, 'test/Counter.t.sol'), 'utf8'), /forge-std/u);
});
test('adopt writes only the binding', () => {
  const root = temp('adopt'); const config = 'export default { solidity: "0.8.26" };\n'; writeFileSync(resolve(root, 'hardhat.config.ts'), config); json(resolve(root, 'package.json'), { devDependencies: { hardhat: '2.22.0' } });
  const result = run(root, ['init', '--framework', 'hardhat', '--adopt', '--target', 'evm']); assert.equal(result.status, 0, result.stderr); assert.equal(readFileSync(resolve(root, 'hardhat.config.ts'), 'utf8'), config);
});
test('hardhat receives literal argv and native exit code', () => {
  const root = temp('hh'); binding(root, 'hardhat', 'evm'); hardhat(root); const result = run(root, ['compile', '$HOME', 'test argument']);
  assert.equal(result.status, 17); assert.equal(result.stdout, '["compile","$HOME","test argument"]');
});
test('legacy framework namespaces are rejected', () => { const result = run(temp('legacy'), ['foundry', 'build']); assert.equal(result.status, 2); assert.match(result.stderr, /namespace is no longer supported.*sunhat build/u); });
test('Hardhat commands are passed through without a namespace', () => {
  const root = temp('hh-toolchain'); binding(root, 'hardhat', 'evm'); hardhat(root);
  const result = run(root, ['toolchain', 'check']);
  assert.equal(result.status, 17); assert.equal(result.stdout, '["toolchain","check"]');
});
test('foundry native commands and tools select exact binaries', () => {
  const root = temp('foundry'); binding(root, 'foundry', 'evm'); foundry(root, 'evm');
  assert.equal(run(root, ['build', '--sizes']).stdout, 'forge:["build","--sizes"]');
  assert.equal(run(root, ['compile', '--force']).stdout, 'forge:["compile","--force"]');
  assert.equal(run(root, ['cast', 'block-number']).stdout, 'cast:["block-number"]');
  const info = run(root, ['toolchain', 'info']);
  assert.equal(info.status, 0); assert.match(info.stdout, /source=foundry-rs\/foundry/u); assert.match(info.stdout, /release=v1\.8\.6/u);
});
test('TRON rejects anvil without launching toolchain', () => { const root = temp('tron'); binding(root, 'foundry', 'tron'); const result = run(root, ['anvil']); assert.equal(result.status, 2); assert.match(result.stderr, /unsupported.*TRON/u); });
test('Hardhat 3 is rejected with resolved version', () => { const root = temp('hh3'); binding(root, 'hardhat', 'evm'); hardhat(root, '3.0.0'); const result = run(root, ['test']); assert.equal(result.status, 3); assert.match(result.stderr, /Hardhat 2.*3\.0\.0/u); });
test('tampered toolchain binary is rejected', () => {
  const root = temp('digest'); binding(root, 'foundry', 'evm'); foundry(root, 'evm'); writeFileSync(resolve(root, '.sunhat/toolchains/evm/forge'), 'tampered');
  const result = run(root, ['build']); assert.equal(result.status, 3); assert.match(result.stderr, /digest mismatch/u);
});
