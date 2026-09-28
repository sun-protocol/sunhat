import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_VERSION = "0.4.3";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compilerPath = process.env.VYPER_JSON_PATH;
const expectedSha256 = process.env.VYPER_JSON_SHA256;

assert.ok(compilerPath, "VYPER_JSON_PATH is required");
assert.ok(expectedSha256, "VYPER_JSON_SHA256 is required");
assert.ok(path.isAbsolute(compilerPath), "VYPER_JSON_PATH must be absolute");
assert.match(expectedSha256, /^[0-9a-f]{64}$/i);

const compilerBytes = await readFile(compilerPath);
const compilerSha256 = sha256(compilerBytes);
assert.equal(
  compilerSha256,
  expectedSha256.toLowerCase(),
  "vyper-json executable SHA-256 mismatch",
);

const versionResult = await runCompiler(compilerPath, ["--version"]);
assert.equal(versionResult.code, 0, versionResult.stderr);
const version = versionResult.stdout.trim();
assert.match(version, new RegExp(`^${EXPECTED_VERSION.replaceAll(".", "\\.")}(?:$|\\+)`));
const environmentLock = await readPythonEnvironmentLock(compilerPath);

const sourceName = "contracts/Depositer.vy";
const sourceContent = await readFile(path.join(projectRoot, sourceName), "utf8");
const input = {
  language: "Vyper",
  sources: {
    [sourceName]: { content: sourceContent },
  },
  settings: {
    evmVersion: "london",
    optimize: "gas",
    outputSelection: {
      "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
    },
  },
};

const compileResult = await runCompiler(compilerPath, [], JSON.stringify(input));
assert.equal(compileResult.code, 0, compileResult.stderr);
const output = JSON.parse(compileResult.stdout);
const fatalErrors = (output.errors ?? []).filter(
  (entry) => entry.severity === "error",
);
assert.deepEqual(fatalErrors, []);

const contractOutput = output.contracts?.[sourceName]?.Depositer;
assert.ok(contractOutput, "vyper-json did not return Depositer output");
assert.ok(Array.isArray(contractOutput.abi));
assert.match(contractOutput.evm.bytecode.object, /^(?:0x)?[0-9a-f]+$/i);
assert.match(contractOutput.evm.deployedBytecode.object, /^(?:0x)?[0-9a-f]+$/i);

const compiler = {
  kind: "vyper",
  version,
  executableSha256: compilerSha256,
  environmentLock,
};
const buildId = sha256(
  Buffer.from(JSON.stringify({ compiler, input }), "utf8"),
);
const artifact = {
  _format: "sunhat-vyper-artifact-1",
  contractName: "Depositer",
  sourceName,
  abi: contractOutput.abi,
  bytecode: normalizeBytecode(contractOutput.evm.bytecode.object),
  deployedBytecode: normalizeBytecode(
    contractOutput.evm.deployedBytecode.object,
  ),
  buildInfoId: buildId,
};

const outputDirectory = path.join(projectRoot, "artifacts-vyper");
const temporaryDirectory = `${outputDirectory}.tmp-${process.pid}`;
await rm(temporaryDirectory, { force: true, recursive: true });
await mkdir(path.join(temporaryDirectory, "contracts", "Depositer.vy"), {
  recursive: true,
});
await mkdir(path.join(temporaryDirectory, "build-info"), { recursive: true });
await writeJson(
  path.join(temporaryDirectory, "contracts", "Depositer.vy", "Depositer.json"),
  artifact,
);
await writeJson(path.join(temporaryDirectory, "build-info", "compiler.json"), compiler);
await writeJson(path.join(temporaryDirectory, "build-info", "input.json"), input);
await writeJson(path.join(temporaryDirectory, "build-info", "output.json"), output);
await rm(outputDirectory, { force: true, recursive: true });
await rename(temporaryDirectory, outputDirectory);

process.stdout.write(
  `${JSON.stringify({
    artifactFormat: artifact._format,
    buildInfoId: buildId,
    compiler,
    contract: `${sourceName}:Depositer`,
  })}\n`,
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeBytecode(value) {
  return value.startsWith("0x") ? value : `0x${value}`;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runCompiler(executable, args, stdin) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: projectRoot,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ code, stderr, stdout });
    });
    child.stdin.end(stdin);
  });
}

async function readPythonEnvironmentLock(executable) {
  const binDirectory = path.dirname(executable);
  const pythonPath = path.join(binDirectory, "python");
  const pipPath = path.join(binDirectory, "pip");
  const [pythonVersion, dependencies] = await Promise.all([
    runCompiler(pythonPath, ["--version"]),
    runCompiler(pipPath, ["freeze", "--disable-pip-version-check"]),
  ]);
  assert.equal(pythonVersion.code, 0, pythonVersion.stderr);
  assert.equal(dependencies.code, 0, dependencies.stderr);
  return {
    python: `${pythonVersion.stdout}${pythonVersion.stderr}`.trim(),
    dependencies: dependencies.stdout
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .sort(),
  };
}
