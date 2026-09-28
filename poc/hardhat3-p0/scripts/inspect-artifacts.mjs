import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = path.join(
  projectRoot,
  "artifacts",
  "contracts",
  "Counter.sol",
  "Counter.json",
);
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));

assert.equal(artifact._format, "hh3-artifact-1");
assert.equal(artifact.contractName, "Counter");
assert.equal(artifact.sourceName, "contracts/Counter.sol");
assert.match(artifact.bytecode, /^0x[0-9a-f]+$/i);
assert.match(artifact.deployedBytecode, /^0x[0-9a-f]+$/i);
assert.equal(typeof artifact.buildInfoId, "string");
assert.ok(artifact.buildInfoId.length > 0);

const buildInfoDirectory = path.join(projectRoot, "artifacts", "build-info");
const buildInfoFiles = await readdir(buildInfoDirectory);
assert.ok(buildInfoFiles.includes(`${artifact.buildInfoId}.json`));
assert.ok(buildInfoFiles.includes(`${artifact.buildInfoId}.output.json`));

const buildInfo = JSON.parse(
  await readFile(
    path.join(buildInfoDirectory, `${artifact.buildInfoId}.json`),
    "utf8",
  ),
);
const buildInfoOutput = JSON.parse(
  await readFile(
    path.join(buildInfoDirectory, `${artifact.buildInfoId}.output.json`),
    "utf8",
  ),
);
assert.equal(buildInfo._format, "hh3-sol-build-info-1");
assert.equal(buildInfoOutput._format, "hh3-sol-build-info-output-1");
assert.equal(buildInfo.id, artifact.buildInfoId);
assert.equal(buildInfoOutput.id, artifact.buildInfoId);

process.stdout.write(
  `${JSON.stringify({
    artifactFormat: artifact._format,
    buildInfoId: artifact.buildInfoId,
    contract: `${artifact.sourceName}:${artifact.contractName}`,
  })}\n`,
);
