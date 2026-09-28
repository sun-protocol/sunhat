import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifact = JSON.parse(
  await readFile(
    path.join(
      projectRoot,
      "artifacts-tron",
      "contracts",
      "Counter.sol",
      "Counter.json",
    ),
    "utf8",
  ),
);
assert.equal(artifact._format, "hh3-artifact-1");
assert.equal(typeof artifact.buildInfoId, "string");

const buildInfo = JSON.parse(
  await readFile(
    path.join(
      projectRoot,
      "artifacts-tron",
      "build-info",
      `${artifact.buildInfoId}.json`,
    ),
    "utf8",
  ),
);
assert.equal(buildInfo._format, "hh3-sol-build-info-1");
assert.equal(buildInfo.solcVersion, "0.8.25");
assert.equal(buildInfo.solcLongVersion, "0.8.25+commit.77bd169f");

const compilerBytes = await readFile(process.env.TRON_SOLC_PATH);
const compilerSha256 = createHash("sha256").update(compilerBytes).digest("hex");
assert.equal(compilerSha256, process.env.TRON_SOLC_SHA256.toLowerCase());

process.stdout.write(
  `${JSON.stringify({
    artifactFormat: artifact._format,
    buildInfoId: artifact.buildInfoId,
    compilerSha256,
    compilerVersion: buildInfo.solcLongVersion,
    contract: `${artifact.sourceName}:${artifact.contractName}`,
  })}\n`,
);
