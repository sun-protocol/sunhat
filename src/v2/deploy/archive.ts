import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import {
  canonicalJson,
  sha256,
  validateSnapshot,
} from '../build/index.js';
import { SunhatDeploymentError } from './errors.js';
import type {
  DeploymentAttempt,
  DeploymentReceipt,
  OnchainCode,
  RuntimeMatchResult,
  VerificationFile,
  VerificationManifest,
} from './types.js';
import type { VerificationSourceMode } from '../config/index.js';

export interface SnapshotArtifact {
  readonly artifact: Readonly<Record<string, unknown>>;
  readonly path: string;
}

export interface ArchiveVerificationOptions {
  readonly attempt: DeploymentAttempt;
  readonly onchain: OnchainCode;
  readonly outputDirectory?: string;
  readonly receipt: DeploymentReceipt;
  readonly runtimeMatch: RuntimeMatchResult;
  readonly sourceMode?: VerificationSourceMode;
}

export async function assertArchiveDestinationWritable(
  projectRoot: string,
  networkKey: string,
  outputDirectory?: string
): Promise<void> {
  const outputRoot = path.resolve(
    outputDirectory ?? path.join(projectRoot, 'verification')
  );
  ensureWithin(projectRoot, outputRoot, 'verification output directory');
  const networkRoot = safeJoin(outputRoot, networkKey);
  await assertNoSymlinkComponents(projectRoot, networkRoot);
  await mkdir(networkRoot, { recursive: true });
  await assertNoSymlinkComponents(projectRoot, networkRoot);
  const rootStats = await lstat(networkRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    unsafe(`verification network path is not a regular directory: ${networkRoot}`);
  }
  const probe = safeJoin(
    networkRoot,
    `.write-probe-${process.pid}-${randomBytes(6).toString('hex')}`
  );
  try {
    await writeFile(probe, '', { flag: 'wx' });
  } finally {
    await rm(probe, { force: true });
  }
}

export async function loadSnapshotArtifact(
  snapshotDirectory: string,
  fullyQualifiedName: string
): Promise<SnapshotArtifact> {
  const separator = fullyQualifiedName.lastIndexOf(':');
  if (separator <= 0 || separator === fullyQualifiedName.length - 1) {
    throw new SunhatDeploymentError(
      'INVALID_DEPLOYMENT_PLAN',
      `fully qualified contract name is required: ${fullyQualifiedName}`
    );
  }
  const sourceName = fullyQualifiedName.slice(0, separator);
  const contractName = fullyQualifiedName.slice(separator + 1);
  const artifactsRoot = path.join(snapshotDirectory, 'artifacts');
  const matches: SnapshotArtifact[] = [];
  await visit(artifactsRoot, '');
  if (matches.length !== 1) {
    throw new SunhatDeploymentError(
      'SNAPSHOT_MISMATCH',
      `expected one artifact for ${fullyQualifiedName}, found ${matches.length}`
    );
  }
  return matches[0];

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = path.join(directory, name);
      const relative = path.posix.join(relativeDirectory, name);
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink()) {
        unsafe(`symbolic link in snapshot artifacts: ${relative}`);
      }
      if (stats.isDirectory()) {
        await visit(absolute, relative);
      } else if (stats.isFile() && name.endsWith('.json')) {
        let value: unknown;
        try {
          value = JSON.parse(await readFile(absolute, 'utf8'));
        } catch {
          continue;
        }
        if (value !== null && typeof value === 'object') {
          const artifact = value as Record<string, unknown>;
          if (
            artifact.sourceName === sourceName &&
            artifact.contractName === contractName
          ) {
            matches.push({ artifact, path: relative });
          }
        }
      }
    }
  }
}

export async function archiveVerification(
  options: ArchiveVerificationOptions
): Promise<string> {
  const { attempt, onchain, receipt, runtimeMatch } = options;
  const sourceMode = options.sourceMode ?? 'multi-file';
  await validateSnapshot(attempt.snapshotDirectory, attempt.buildId);
  if (receipt.status !== 'success' || receipt.address === undefined) {
    throw new SunhatDeploymentError(
      'ARCHIVE_FAILED',
      'verification archive requires a successful deployment receipt'
    );
  }
  if (
    receipt.transactionId !== attempt.transactionId ||
    canonicalAddress(receipt.address) !== canonicalAddress(onchain.address)
  ) {
    throw new SunhatDeploymentError(
      'ARCHIVE_FAILED',
      'receipt and on-chain evidence do not identify the same deployment'
    );
  }
  const address = canonicalAddress(receipt.address);
  const outputRoot = path.resolve(
    options.outputDirectory ?? path.join(attempt.projectRoot, 'verification')
  );
  ensureWithin(attempt.projectRoot, outputRoot, 'verification output directory');
  const networkRoot = safeJoin(outputRoot, attempt.networkKey);
  const finalDirectory = safeJoin(networkRoot, `verfication-${address}`);
  await mkdir(networkRoot, { recursive: true });

  const existing = await existingArchive(finalDirectory);
  if (existing !== undefined) {
    if (
      existing.buildId === attempt.buildId &&
      existing.transactionId === receipt.transactionId &&
      existing.networkKey === attempt.networkKey
    ) {
      return finalDirectory;
    }
    throw new SunhatDeploymentError(
      'ATTEMPT_CONFLICT',
      `verification archive already exists for ${address} with a different deployment`
    );
  }

  const lockDirectory = `${finalDirectory}.lock`;
  try {
    await mkdir(lockDirectory);
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      throw new SunhatDeploymentError(
        'ATTEMPT_CONFLICT',
        `verification archive is locked for ${address}`
      );
    }
    throw error;
  }

  const temporaryDirectory = safeJoin(
    networkRoot,
    `.tmp-${address}-${process.pid}-${randomBytes(6).toString('hex')}`
  );
  try {
    await mkdir(temporaryDirectory);
    await copyTree(
      path.join(attempt.snapshotDirectory, 'sources'),
      path.join(temporaryDirectory, 'sources')
    );
    await copyTree(
      path.join(attempt.snapshotDirectory, 'artifacts'),
      path.join(temporaryDirectory, 'artifacts')
    );
    await copyBuildInfo(
      path.join(attempt.snapshotDirectory, 'artifacts'),
      path.join(temporaryDirectory, 'build-info')
    );
    await copyFile(
      path.join(attempt.snapshotDirectory, 'manifest.json'),
      path.join(temporaryDirectory, 'build-manifest.json')
    );
    await copyFile(
      path.join(attempt.snapshotDirectory, 'metadata.json'),
      path.join(temporaryDirectory, 'build-metadata.json')
    );
    await writeJson(path.join(temporaryDirectory, 'deployment.json'), {
      ...attempt.deployment,
      attemptId: attempt.attemptId,
      transaction: attempt.transaction,
      transactionId: receipt.transactionId,
    });
    await writeJson(path.join(temporaryDirectory, 'receipt.json'), receipt.raw);
    await writeJson(path.join(temporaryDirectory, 'onchain.json'), {
      address,
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber,
      code: onchain.code,
      codeHash: runtimeMatch.observedCodeHash,
      confirmations: receipt.confirmations,
      network: attempt.network,
      queriedAt: new Date().toISOString(),
      queriedBlockHash: onchain.queriedBlockHash,
      queriedBlockNumber: onchain.queriedBlockNumber,
      runtimeMatch,
      transactionId: receipt.transactionId,
    });
    const isVyper = attempt.deployment.fullyQualifiedName
      .slice(0, attempt.deployment.fullyQualifiedName.lastIndexOf(':'))
      .endsWith('.vy');
    if (!isVyper && (sourceMode === 'flatten' || sourceMode === 'both')) {
      await writeFlattenedExport(
        path.join(attempt.snapshotDirectory, 'sources'),
        path.join(temporaryDirectory, 'flattened'),
        attempt.deployment.fullyQualifiedName
      );
    }
    await writeFile(
      path.join(temporaryDirectory, 'README.md'),
      verificationReadme(attempt, address, receipt.transactionId, runtimeMatch),
      { encoding: 'utf8', flag: 'wx' }
    );
    const files = await hashFiles(temporaryDirectory);
    await validateHashedFiles(temporaryDirectory, files);
    const manifest: VerificationManifest = {
      schema: 'sunhat-verification-1',
      address,
      archiveState: 'complete',
      buildId: attempt.buildId,
      chain: attempt.network.chain,
      files,
      fullyQualifiedName: attempt.deployment.fullyQualifiedName,
      generatedAt: new Date().toISOString(),
      ...(sourceMode === 'multi-file' || isVyper
        ? {}
        : { flattenStatus: 'unverified-export' as const }),
      language: isVyper ? 'vyper' : 'solidity',
      network: attempt.network,
      networkKey: attempt.networkKey,
      sourceMode,
      target: attempt.deployment.target,
      transactionId: receipt.transactionId,
    };
    await writeJson(path.join(temporaryDirectory, 'manifest.json'), manifest);
    await rename(temporaryDirectory, finalDirectory);
    return finalDirectory;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
    await rmdir(lockDirectory).catch(() => undefined);
  }
}

async function existingArchive(
  directory: string
): Promise<VerificationManifest | undefined> {
  try {
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      unsafe(`verification archive is not a regular directory: ${directory}`);
    }
    const manifestPath = path.join(directory, 'manifest.json');
    const manifestStats = await lstat(manifestPath);
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
      unsafe(`verification manifest is not a regular file: ${manifestPath}`);
    }
    const manifest = JSON.parse(
      await readFile(manifestPath, 'utf8')
    ) as VerificationManifest;
    if (
      manifest.schema !== 'sunhat-verification-1' ||
      !Array.isArray(manifest.files)
    ) {
      throw new SunhatDeploymentError(
        'ARCHIVE_FAILED',
        `invalid existing verification manifest: ${manifestPath}`
      );
    }
    const actualFiles = (await hashFiles(directory)).filter(
      ({ path: filePath }) => filePath !== 'manifest.json'
    );
    const expectedFiles = [...manifest.files].sort((left, right) =>
      left.path.localeCompare(right.path)
    );
    if (canonicalJson(actualFiles) !== canonicalJson(expectedFiles)) {
      throw new SunhatDeploymentError(
        'ARCHIVE_FAILED',
        `existing verification archive failed integrity validation: ${directory}`
      );
    }
    return manifest;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function copyTree(source: string, destination: string): Promise<void> {
  const stats = await lstat(source);
  if (stats.isSymbolicLink()) unsafe(`symbolic link cannot be archived: ${source}`);
  if (stats.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const name of (await readdir(source)).sort()) {
      await copyTree(path.join(source, name), path.join(destination, name));
    }
  } else if (stats.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  } else {
    unsafe(`special file cannot be archived: ${source}`);
  }
}

async function copyBuildInfo(
  artifactsDirectory: string,
  destination: string
): Promise<void> {
  let copied = false;
  await visit(artifactsDirectory, '');
  if (!copied) {
    throw new SunhatDeploymentError(
      'ARCHIVE_FAILED',
      'snapshot has no compiler build-info directory'
    );
  }

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = path.join(directory, name);
      const relative = path.posix.join(relativeDirectory, name);
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink()) unsafe(`symbolic link cannot be archived: ${relative}`);
      if (!stats.isDirectory()) continue;
      if (name === 'build-info') {
        const parent = path.posix.dirname(relative);
        await copyTree(
          absolute,
          path.join(destination, parent === '.' ? 'root' : parent)
        );
        copied = true;
      } else {
        await visit(absolute, relative);
      }
    }
  }
}

async function writeFlattenedExport(
  sourcesDirectory: string,
  destination: string,
  fullyQualifiedName: string
): Promise<void> {
  const sources: Array<{ path: string; content: string }> = [];
  await collect(sourcesDirectory, '');
  await mkdir(destination, { recursive: true });
  const contractName = fullyQualifiedName.slice(fullyQualifiedName.lastIndexOf(':') + 1);
  const body = sources
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path: sourcePath, content }) =>
      `// ---- source-unit: ${sourcePath} ----\n${content.trimEnd()}\n`
    )
    .join('\n');
  await writeFile(
    path.join(destination, `${contractName}.flattened.sol`),
    `// UNVERIFIED FLATTENED EXPORT. Use build-info Standard JSON for exact reproduction.\n${body}`,
    { encoding: 'utf8', flag: 'wx' }
  );
  await writeFile(
    path.join(destination, 'README.md'),
    'This view is a deterministic convenience export. It retains imports, SPDX declarations, and pragma statements, so it is not marked as browser-submittable or bytecode-equivalent. The original source units and compiler input remain authoritative.\n',
    { encoding: 'utf8', flag: 'wx' }
  );

  async function collect(directory: string, relativeDirectory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = path.join(directory, name);
      const relative = path.posix.join(relativeDirectory, name);
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink()) unsafe(`symbolic link cannot be flattened: ${relative}`);
      if (stats.isDirectory()) {
        await collect(absolute, relative);
      } else if (stats.isFile() && relative.endsWith('.sol')) {
        sources.push({ path: relative, content: await readFile(absolute, 'utf8') });
      }
    }
  }
}

async function hashFiles(directory: string): Promise<VerificationFile[]> {
  const files: VerificationFile[] = [];
  await visit(directory, '');
  return files.sort((left, right) => left.path.localeCompare(right.path));

  async function visit(absoluteDirectory: string, relativeDirectory: string) {
    for (const name of (await readdir(absoluteDirectory)).sort()) {
      const absolute = path.join(absoluteDirectory, name);
      const relative = path.posix.join(relativeDirectory, name);
      const stats = await lstat(absolute);
      if (stats.isSymbolicLink()) unsafe(`symbolic link cannot be hashed: ${relative}`);
      if (stats.isDirectory()) {
        await visit(absolute, relative);
      } else if (stats.isFile()) {
        const content = await readFile(absolute);
        files.push({ path: relative, sha256: sha256(content), size: stats.size });
      } else {
        unsafe(`special file cannot be hashed: ${relative}`);
      }
    }
  }
}

async function validateHashedFiles(
  directory: string,
  files: readonly VerificationFile[]
): Promise<void> {
  for (const file of files) {
    const filename = safeJoin(directory, file.path);
    const stats = await lstat(filename);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      unsafe(`verification entry is not a regular file: ${file.path}`);
    }
    const content = await readFile(filename);
    if (stats.size !== file.size || sha256(content) !== file.sha256) {
      throw new SunhatDeploymentError(
        'ARCHIVE_FAILED',
        `verification entry changed before atomic commit: ${file.path}`
      );
    }
  }
}

async function writeJson(filename: string, value: unknown): Promise<void> {
  await writeFile(filename, `${canonicalJson(value)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

function verificationReadme(
  attempt: DeploymentAttempt,
  address: string,
  transactionId: string,
  runtimeMatch: RuntimeMatchResult
): string {
  return `# Deployment verification bundle

This directory is an immutable, offline verification input for \`${attempt.deployment.fullyQualifiedName}\`.

- Network: \`${attempt.network.name}\` (\`${attempt.network.chain}:${attempt.network.chainId}\`)
- Address: \`${address}\`
- Transaction: \`${transactionId}\`
- Build ID: \`${attempt.buildId}\`
- Runtime match: \`${runtimeMatch.status}\`

Rebuild from the compiler input and metadata under \`artifacts/\`. Source files are copied from the validated build snapshot, not from the current project tree. Verify every file against \`manifest.json\` before using the bundle.
`;
}

function canonicalAddress(address: string): string {
  const value = address.trim();
  if (!/^(0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33})$/.test(value)) {
    throw new SunhatDeploymentError(
      'ARCHIVE_FAILED',
      `invalid EVM or TRON deployment address: ${address}`
    );
  }
  return value.startsWith('0x') ? value.toLowerCase() : value;
}

function ensureWithin(root: string, candidate: string, label: string): void {
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, path.resolve(candidate));
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    unsafe(`${label} escapes project root`);
  }
}

async function assertNoSymlinkComponents(
  root: string,
  candidate: string
): Promise<void> {
  const resolvedRoot = path.resolve(root);
  ensureWithin(resolvedRoot, candidate, 'archive path');
  const relative = path.relative(resolvedRoot, path.resolve(candidate));
  let current = resolvedRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        unsafe(`archive path contains a symbolic link: ${current}`);
      }
      if (!stats.isDirectory()) {
        unsafe(`archive path component is not a directory: ${current}`);
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return;
      throw error;
    }
  }
}

function safeJoin(root: string, entry: string): string {
  const output = path.resolve(root, entry);
  const relative = path.relative(path.resolve(root), output);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    unsafe(`archive path escapes its root: ${entry}`);
  }
  return output;
}

function unsafe(message: string): never {
  throw new SunhatDeploymentError('UNSAFE_ARCHIVE_PATH', message);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
