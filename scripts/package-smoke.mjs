#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), 'sunhat-package-smoke-')
);
const packDirectory = path.join(temporaryRoot, 'pack');
const globalPrefixDirectory = path.join(temporaryRoot, 'global');
const fixtureDirectory = path.join(temporaryRoot, 'sunhat-package-fixture');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const childEnvironment = {
  ...selectChildEnvironment(process.env),
  NO_COLOR: '1',
  TRON_PRIVATE_KEY: '',
  TRON_RPC_URL: 'http://127.0.0.1:1',
};

try {
  const packageJson = JSON.parse(
    await readFile(path.join(projectRoot, 'package.json'), 'utf8')
  );
  await mkdir(packDirectory, { recursive: true });
  const packResult = await run(
    npmExecutable,
    ['pack', '--json', '--pack-destination', packDirectory],
    projectRoot
  );
  const packed = parsePackResult(packResult.stdout);
  const packedBin = packed.files.find(
    (file) => file.path === 'dist/cli/bin.js'
  );
  assert.ok(packedBin, 'tarball does not contain dist/cli/bin.js');
  if (process.platform !== 'win32') {
    assert.equal(
      packedBin.mode & 0o111,
      0o111,
      'tarball CLI entry is not executable'
    );
  }
  const tarballPath = await resolvePackedTarball(
    packDirectory,
    packed.filename
  );

  await run(
    npmExecutable,
    [
      'install',
      '--global',
      '--prefix',
      globalPrefixDirectory,
      '--omit=peer',
      '--no-audit',
      '--no-fund',
      tarballPath,
    ],
    temporaryRoot
  );
  const globalBinDirectory =
    process.platform === 'win32'
      ? globalPrefixDirectory
      : path.join(globalPrefixDirectory, 'bin');
  const commandName = process.platform === 'win32' ? 'sunhat.cmd' : 'sunhat';
  const globalVersion = await run(
    commandName,
    ['--version'],
    temporaryRoot,
    withExecutablePath(globalBinDirectory)
  );
  assert.equal(globalVersion.stdout.trim(), packageJson.version);

  const templateModule = await import(
    pathToFileURL(path.join(projectRoot, 'dist', 'cli', 'template.js')).href
  );
  const template = templateModule.createProjectTemplate({
    projectName: 'sunhat-package-fixture',
    sunhatVersion: packageJson.version,
  });
  await templateModule.writeProjectTemplate(fixtureDirectory, template);
  await bindTemplateToTarball(fixtureDirectory, tarballPath);

  await run(
    npmExecutable,
    ['install', '--no-audit', '--no-fund'],
    fixtureDirectory
  );
  await assertInstalledPackage(fixtureDirectory, packageJson.version);

  const hardhatBin = executablePath(fixtureDirectory, 'hardhat');
  const sunhatBin = executablePath(fixtureDirectory, 'sunhat');
  const nestedWorkingDirectory = path.join(fixtureDirectory, 'test');
  const version = await run(
    commandName,
    ['--version'],
    temporaryRoot,
    withExecutablePath(path.dirname(sunhatBin))
  );
  assert.equal(version.stdout.trim(), packageJson.version);
  const help = await run(hardhatBin, ['--help'], nestedWorkingDirectory);
  for (const task of [
    'sunhat clean',
    'sunhat compile',
    'sunhat deploy',
    'sunhat test',
    'sunhat verification',
  ]) {
    assert.match(help.stdout, new RegExp(escapeRegExp(task)));
  }

  const initialCompile = parseJsonLine(
    (
      await run(
        sunhatBin,
        ['compile', '--target', 'evm'],
        nestedWorkingDirectory
      )
    ).stdout
  );
  assert.equal(initialCompile.target, 'evm');
  assert.equal(initialCompile.cacheHit, false);
  assert.match(initialCompile.buildId, /^[0-9a-f]{64}$/u);
  await assertInsideFixture(
    fixtureDirectory,
    initialCompile.snapshotDirectory,
    'snapshot directory'
  );

  const clean = parseJsonLine(
    (await run(sunhatBin, ['clean'], nestedWorkingDirectory)).stdout
  );
  assert.deepEqual(clean.preserved, [
    'build-snapshots',
    'deployments',
    'verification',
  ]);
  assert.ok(clean.removed.includes('artifacts/sunhat'));
  assert.ok(clean.removed.includes('cache/sunhat'));
  assert.equal(
    await pathExists(path.join(fixtureDirectory, 'artifacts', 'sunhat')),
    false
  );
  assert.equal(
    await pathExists(path.join(fixtureDirectory, 'cache', 'sunhat')),
    false
  );
  await access(initialCompile.snapshotDirectory);

  const restoredCompile = parseJsonLine(
    (
      await run(
        sunhatBin,
        ['compile', '--target', 'evm'],
        nestedWorkingDirectory
      )
    ).stdout
  );
  assert.equal(restoredCompile.buildId, initialCompile.buildId);
  assert.equal(restoredCompile.cacheHit, true);
  assert.equal(
    restoredCompile.snapshotDirectory,
    initialCompile.snapshotDirectory
  );

  const testResult = await run(sunhatBin, ['test'], nestedWorkingDirectory);
  assert.match(testResult.stdout, /2 passing \(1 solidity, 1 mocha\)/u);

  process.stdout.write(
    `${JSON.stringify({
      buildId: initialCompile.buildId,
      packageSize: packed.size,
      packageVersion: packageJson.version,
      tests: { mocha: 1, solidity: 1 },
    })}\n`
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

async function bindTemplateToTarball(projectDirectory, tarballPath) {
  const packageJsonPath = path.join(projectDirectory, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  packageJson.devDependencies['@sun-protocol/sunhat'] =
    pathToFileURL(tarballPath).href;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function assertInstalledPackage(projectDirectory, expectedVersion) {
  const installedPackageRoot = path.join(
    projectDirectory,
    'node_modules',
    '@sun-protocol',
    'sunhat'
  );
  const installedPackageJson = JSON.parse(
    await readFile(path.join(installedPackageRoot, 'package.json'), 'utf8')
  );
  assert.equal(installedPackageJson.version, expectedVersion);
  assert.equal(
    await pathExists(path.join(installedPackageRoot, 'legacy')),
    false
  );
  assert.equal(
    await pathExists(path.join(installedPackageRoot, 'scripts')),
    false
  );
  await access(path.join(installedPackageRoot, 'dist', 'cli', 'bin.js'));
  if (process.platform !== 'win32') {
    await access(
      path.join(installedPackageRoot, 'dist', 'cli', 'bin.js'),
      constants.X_OK
    );
  }
  await access(path.join(installedPackageRoot, 'skills', 'sunhat', 'SKILL.md'));
  await access(executablePath(projectDirectory, 'sunhat'));
}

async function assertInsideFixture(projectDirectory, candidate, label) {
  const root = await realpath(projectDirectory);
  const resolvedCandidate = await realpath(candidate);
  const relative = path.relative(root, resolvedCandidate);
  assert.ok(
    relative !== '' &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    `${label} escapes package fixture: ${resolvedCandidate}`
  );
}

async function resolvePackedTarball(directory, filename) {
  assert.equal(
    path.basename(filename),
    filename,
    'npm pack returned an unsafe filename'
  );
  const root = await realpath(directory);
  const tarball = await realpath(path.join(root, filename));
  assert.equal(
    path.dirname(tarball),
    root,
    'packed tarball escaped its output directory'
  );
  return tarball;
}

function parsePackResult(output) {
  const parsed = JSON.parse(output);
  const results = Array.isArray(parsed) ? parsed : Object.values(parsed);
  assert.equal(results.length, 1, 'unexpected npm pack output');
  assert.equal(typeof results[0].filename, 'string');
  assert.equal(typeof results[0].size, 'number');
  return results[0];
}

function parseJsonLine(output) {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'));
  assert.ok(lines.length > 0, `command did not emit JSON: ${output}`);
  return JSON.parse(lines.at(-1));
}

function executablePath(projectDirectory, name) {
  const extension = process.platform === 'win32' ? '.cmd' : '';
  return path.join(
    projectDirectory,
    'node_modules',
    '.bin',
    `${name}${extension}`
  );
}

function selectChildEnvironment(environment) {
  const selected = {};
  for (const key of [
    'CI',
    'COMSPEC',
    'HOME',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NPM_CONFIG_CACHE',
    'NO_PROXY',
    'PATH',
    'PATHEXT',
    'SHELL',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TMPDIR',
    'USERPROFILE',
    'http_proxy',
    'https_proxy',
    'npm_config_cache',
    'npm_config_registry',
    'no_proxy',
  ]) {
    if (environment[key] !== undefined) {
      selected[key] = environment[key];
    }
  }
  return selected;
}

function withExecutablePath(directory) {
  return {
    ...childEnvironment,
    PATH: [directory, childEnvironment.PATH]
      .filter(Boolean)
      .join(path.delimiter),
  };
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function run(executable, arguments_, cwd, environment = childEnvironment) {
  try {
    return await execFileAsync(executable, arguments_, {
      cwd,
      encoding: 'utf8',
      env: environment,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const stdout = typeof error.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    throw new Error(
      `command failed: ${executable} ${arguments_.join(' ')}\n${stdout}${stderr}`,
      { cause: error }
    );
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
