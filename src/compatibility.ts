import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { readJson } from './json.js';
import { isCompatibleDependency } from './versions.js';

const version = z.string().regex(/^\d+\.\d+\.\d+$/u);
const minimum = z.object({
  major: z.number().int().positive(),
  minor: z.number().int().nonnegative(),
});
const schema = z.object({
  node: z.object({
    majors: z.array(z.number().int().positive().multipleOf(2)).nonempty(),
    minimum: z.object({
      cli: minimum,
      hardhat3: minimum,
      hardhat2Tron: minimum,
    }),
    tested: z.array(version).nonempty(),
    tooling: version,
  }),
  hardhat3Tron: z.record(
    z.object({
      minimum: version,
      tested: version,
      entry: z.string().min(1).optional(),
    }),
  ),
});

export function readCompatibility(path: string) {
  const result = schema.safeParse(readJson(path));
  if (!result.success) {
    throw new Error(
      `Invalid compatibility policy in ${path}: ${result.error.message}`,
      { cause: result.error },
    );
  }
  const policy = result.data;
  const fail = (message: string): never => {
    throw new Error(`Invalid compatibility policy in ${path}: ${message}`);
  };
  const { node, hardhat3Tron } = policy;
  if (
    new Set(node.majors).size !== node.majors.length ||
    node.majors.some(
      (major, index) => index > 0 && major <= (node.majors[index - 1] ?? 0),
    )
  ) {
    fail('Node majors must be unique and ascending');
  }
  if (
    !node.tested.includes(node.tooling) ||
    node.tested.length !== node.majors.length
  ) {
    fail('Every Node major must have one tested version, including tooling');
  }
  for (const minimum of Object.values(node.minimum)) {
    if (!node.majors.includes(minimum.major)) {
      fail('Minimum Node major must be allowed');
    }
    const tested = node.tested.find(
      (entry) => Number(entry.split('.')[0]) === minimum.major,
    );
    if (tested === undefined || Number(tested.split('.')[1]) < minimum.minor) {
      fail('Tested Node must satisfy its minimum');
    }
  }
  for (const [index, tested] of node.tested.entries()) {
    if (Number(tested.split('.')[0]) !== node.majors[index]) {
      fail('Tested Node versions must match allowed majors in order');
    }
  }
  if (Object.keys(hardhat3Tron).length === 0) {
    fail('TRON dependency policy must not be empty');
  }
  for (const [name, dependency] of Object.entries(hardhat3Tron)) {
    if (!isCompatibleDependency(dependency.tested, dependency.minimum)) {
      fail(`${name} tested version is outside its supported range`);
    }
    if (
      dependency.entry !== undefined &&
      dependency.entry !== name &&
      dependency.entry !== `${name}/package.json`
    ) {
      fail(`${name} must resolve its own public entry`);
    }
  }
  Object.freeze(policy.node.majors);
  Object.freeze(policy.node.tested);
  for (const minimum of Object.values(policy.node.minimum)) {
    Object.freeze(minimum);
  }
  Object.freeze(policy.node.minimum);
  Object.freeze(policy.node);
  for (const dependency of Object.values(policy.hardhat3Tron)) {
    Object.freeze(dependency);
  }
  Object.freeze(policy.hardhat3Tron);
  return Object.freeze(policy);
}

export const compatibility = readCompatibility(
  fileURLToPath(new URL('../config/compatibility.json', import.meta.url)),
);
