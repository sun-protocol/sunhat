import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compatibility } from '../dist/compatibility.js';

const json = (path) =>
  JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const { node, hardhat3Tron } = compatibility;
const engines = (minimum) =>
  node.majors
    .filter((major) => major >= minimum.major)
    .map(
      (major) => `^${major}.${major === minimum.major ? minimum.minor : 0}.0`,
    )
    .join(' || ');
for (const [path, minimum] of [
  ['package.json', node.minimum.cli],
  ['templates/foundry/evm/package.json', node.minimum.cli],
  ['templates/foundry/tron/package.json', node.minimum.cli],
  ['templates/hardhat/v2/evm/package.json', node.minimum.cli],
  ['templates/hardhat/v2/tron/package.json', node.minimum.hardhat2Tron],
  ['templates/hardhat/v3/evm/package.json', node.minimum.hardhat3],
  ['templates/hardhat/v3/tron/package.json', node.minimum.hardhat3],
]) {
  assert.equal(
    json(path).engines.node,
    engines(minimum),
    `${path} Node engines differ from policy`,
  );
}
const root = json('package.json');
const lock = json('package-lock.json');
assert.equal(
  lock.packages[''].engines.node,
  root.engines.node,
  'Lockfile Node engines differ',
);
const template = json('templates/hardhat/v3/tron/package.json');
const evmTemplate = json('templates/hardhat/v3/evm/package.json');
for (const [name, policy] of Object.entries(hardhat3Tron)) {
  assert.equal(
    root.devDependencies[name],
    policy.tested,
    `${name} root pin differs`,
  );
  assert.equal(
    template.devDependencies[name],
    policy.tested,
    `${name} TRON template pin differs`,
  );
  if (name in evmTemplate.devDependencies) {
    assert.equal(
      evmTemplate.devDependencies[name],
      policy.tested,
      `${name} EVM template pin differs`,
    );
  }
  assert.equal(
    lock.packages[`node_modules/${name}`].version,
    policy.tested,
    `${name} lockfile pin differs`,
  );
  assert.equal(
    root.peerDependencies[name],
    '*',
    `${name} must remain an unrestricted optional peer`,
  );
  assert.equal(
    lock.packages[''].devDependencies[name],
    policy.tested,
    `${name} root lockfile pin differs`,
  );
  assert.equal(
    root.peerDependenciesMeta[name]?.optional,
    true,
    `${name} must remain an optional peer`,
  );
}
console.log(
  'Compatibility policy matches package engines, lockfile, templates and tested dependencies.',
);
