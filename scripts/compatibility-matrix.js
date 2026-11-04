import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// This bootstrap runs before npm install or a build in GitHub Actions.
// check:compatibility validates the policy against every published boundary.
const { node } = JSON.parse(
  readFileSync(
    new URL('../config/compatibility.json', import.meta.url),
    'utf8',
  ),
);
const hardhat3 = node.tested.filter((version) => {
  const [major, minor] = version.split('.').map(Number);
  return (
    node.majors.includes(major) &&
    (major > node.minimum.hardhat3.major ||
      (major === node.minimum.hardhat3.major &&
        minor >= node.minimum.hardhat3.minor))
  );
});
assert.ok(hardhat3.length > 0, 'Hardhat 3 CI matrix must not be empty');
assert.ok(
  hardhat3.includes(node.tooling),
  'Tooling Node must be in the Hardhat 3 matrix',
);
const otherHardhat3 = hardhat3.filter((version) => version !== node.tooling);
assert.ok(
  otherHardhat3.length > 0,
  'Additional Hardhat 3 CI versions are required',
);
assert.ok(
  node.tested.includes(`${node.minimum.cli.major}.${node.minimum.cli.minor}.0`),
  'Minimum CLI Node must be tested',
);
for (const version of node.tested) {
  assert.match(version, /^\d+\.\d+\.\d+$/u);
}
for (const [name, value] of Object.entries({
  tooling: node.tooling,
  minimum: `${node.minimum.cli.major}.${node.minimum.cli.minor}.0`,
  hardhat3: JSON.stringify(hardhat3),
  otherHardhat3: JSON.stringify(otherHardhat3),
})) {
  console.log(`${name}=${value}`);
}
