import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { canonicalJson, sha256 } from '../build/index.js';
import { SunhatDeploymentError } from './errors.js';
import type {
  DeploymentAttempt,
  DeploymentAttemptStatus,
  DeploymentPlan,
  DeploymentReceipt,
  DeploymentTransaction,
  NetworkIdentity,
} from './types.js';

export class DeploymentAttemptStore {
  readonly #projectRoot: string;

  public constructor(projectRoot: string) {
    this.#projectRoot = path.resolve(projectRoot);
  }

  public async create(
    plan: DeploymentPlan,
    network: NetworkIdentity,
    networkKey: string,
    transaction: DeploymentTransaction
  ): Promise<DeploymentAttempt> {
    assertSerializable(plan.constructorArguments);
    const stableInput = {
      buildId: plan.buildId,
      deployment: {
        constructorArguments: plan.constructorArguments,
        encodedConstructorArguments: plan.encodedConstructorArguments,
        fullyQualifiedName: plan.fullyQualifiedName,
        initCode: plan.initCode,
        libraries: plan.libraries ?? {},
        target: plan.target,
        value: plan.value ?? '0',
      },
      network,
      networkKey,
      snapshotDirectory: path.resolve(plan.snapshotDirectory),
      transaction,
    };
    const attemptId = sha256(canonicalJson(stableInput));
    const now = new Date().toISOString();
    const attempt: DeploymentAttempt = {
      schema: 'sunhat-deployment-attempt-1',
      attemptId,
      buildId: plan.buildId,
      confirmations: plan.confirmations ?? 1,
      createdAt: now,
      deployment: stableInput.deployment,
      network,
      networkKey,
      observations: [],
      projectRoot: this.#projectRoot,
      snapshotDirectory: stableInput.snapshotDirectory,
      status: 'prepared',
      transaction,
      updatedAt: now,
    };
    const filename = this.pathFor(networkKey, attemptId);
    try {
      const existing = await this.read(networkKey, attemptId);
      throw new SunhatDeploymentError(
        'ATTEMPT_CONFLICT',
        `deployment attempt ${existing.attemptId} already exists with status ${existing.status}; recover it instead of broadcasting again`,
        { attemptId: existing.attemptId }
      );
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
    await atomicWrite(filename, attempt, this.#projectRoot, true);
    return attempt;
  }

  public async read(
    networkKey: string,
    attemptId: string
  ): Promise<DeploymentAttempt> {
    validateIdentifier(networkKey, 'network key');
    validateIdentifier(attemptId, 'attempt id');
    const filename = this.pathFor(networkKey, attemptId);
    await assertSafeParents(this.#projectRoot, filename);
    const stats = await lstat(filename);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new SunhatDeploymentError(
        'ATTEMPT_NOT_FOUND',
        `deployment attempt is not a regular file: ${filename}`
      );
    }
    const attempt = JSON.parse(await readFile(filename, 'utf8')) as DeploymentAttempt;
    if (
      attempt.schema !== 'sunhat-deployment-attempt-1' ||
      attempt.attemptId !== attemptId ||
      attempt.networkKey !== networkKey ||
      path.resolve(attempt.projectRoot) !== this.#projectRoot
    ) {
      throw new SunhatDeploymentError(
        'ATTEMPT_CONFLICT',
        `deployment attempt identity mismatch: ${filename}`
      );
    }
    return attempt;
  }

  public async update(
    attempt: DeploymentAttempt,
    patch: {
      readonly error?: string;
      readonly receipt?: DeploymentReceipt;
      readonly status: DeploymentAttemptStatus;
      readonly transactionId?: string;
      readonly verificationDirectory?: string;
    }
  ): Promise<DeploymentAttempt> {
    const current = await this.read(attempt.networkKey, attempt.attemptId);
    if (
      current.buildId !== attempt.buildId ||
      current.transaction.recoveryId !== attempt.transaction.recoveryId
    ) {
      throw new SunhatDeploymentError(
        'ATTEMPT_CONFLICT',
        `deployment attempt changed while updating ${attempt.attemptId}`
      );
    }
    const updated: DeploymentAttempt = {
      ...current,
      ...(patch.error === undefined ? {} : { error: patch.error }),
      ...(patch.receipt === undefined ? {} : { receipt: patch.receipt }),
      observations:
        patch.receipt === undefined
          ? current.observations ?? []
          : appendObservation(current.observations ?? [], patch.receipt),
      ...(patch.transactionId === undefined
        ? {}
        : { transactionId: patch.transactionId }),
      ...(patch.verificationDirectory === undefined
        ? {}
        : { verificationDirectory: patch.verificationDirectory }),
      status: patch.status,
      updatedAt: new Date().toISOString(),
    };
    await atomicWrite(
      this.pathFor(attempt.networkKey, attempt.attemptId),
      updated,
      this.#projectRoot
    );
    return updated;
  }

  public async findByTransactionId(
    networkKey: string,
    transactionId: string
  ): Promise<DeploymentAttempt> {
    validateIdentifier(networkKey, 'network key');
    const directory = path.dirname(this.pathFor(networkKey, 'lookup'));
    await assertSafeParents(this.#projectRoot, path.join(directory, 'lookup.json'));
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new SunhatDeploymentError(
          'ATTEMPT_NOT_FOUND',
          `no deployment attempt found for transaction ${transactionId}`
        );
      }
      throw error;
    }
    const matches: DeploymentAttempt[] = [];
    for (const name of names.sort()) {
      const match = /^([a-f0-9]{64})\.json$/.exec(name);
      if (match === null) continue;
      const attempt = await this.read(networkKey, match[1]);
      if (
        attempt.transactionId === transactionId ||
        attempt.transaction.transactionId === transactionId
      ) {
        matches.push(attempt);
      }
    }
    if (matches.length === 0) {
      throw new SunhatDeploymentError(
        'ATTEMPT_NOT_FOUND',
        `no deployment attempt found for transaction ${transactionId}`
      );
    }
    if (matches.length !== 1) {
      throw new SunhatDeploymentError(
        'ATTEMPT_CONFLICT',
        `multiple deployment attempts reference transaction ${transactionId}`
      );
    }
    return matches[0];
  }

  public pathFor(networkKey: string, attemptId: string): string {
    validateIdentifier(networkKey, 'network key');
    validateIdentifier(attemptId, 'attempt id');
    return path.join(
      this.#projectRoot,
      'deployments',
      '.sunhat',
      'attempts',
      networkKey,
      `${attemptId}.json`
    );
  }
}

function appendObservation(
  observations: readonly DeploymentReceipt[],
  receipt: DeploymentReceipt
): readonly DeploymentReceipt[] {
  const encoded = canonicalJson(receipt);
  if (observations.some((entry) => canonicalJson(entry) === encoded)) {
    return observations;
  }
  return [...observations, receipt];
}

async function atomicWrite(
  filename: string,
  value: unknown,
  safeRoot: string,
  exclusive = false
): Promise<void> {
  await assertSafeParents(safeRoot, filename);
  await mkdir(path.dirname(filename), { recursive: true });
  await assertSafeParents(safeRoot, filename);
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  await writeFile(temporary, `${canonicalJson(value)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    if (exclusive) {
      try {
        await link(temporary, filename);
        return;
      } finally {
        await rm(temporary, { force: true });
      }
    }
    await rename(temporary, filename);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function assertSafeParents(root: string, filename: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const parent = path.dirname(path.resolve(filename));
  const relative = path.relative(resolvedRoot, parent);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new SunhatDeploymentError(
      'UNSAFE_ARCHIVE_PATH',
      'deployment attempt path escapes project root'
    );
  }
  let current = resolvedRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new SunhatDeploymentError(
          'UNSAFE_ARCHIVE_PATH',
          `unsafe deployment attempt path component: ${current}`
        );
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return;
      throw error;
    }
  }
}

function assertSerializable(value: unknown, seen = new Set<object>()): void {
  if (
    value === null ||
    ['string', 'boolean'].includes(typeof value) ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  ) {
    return;
  }
  if (typeof value === 'bigint') {
    throw new SunhatDeploymentError(
      'INVALID_DEPLOYMENT_PLAN',
      'bigint deployment values must be encoded as unsigned decimal strings'
    );
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertSerializable(entry, seen);
    return;
  }
  if (typeof value === 'object') {
    if (seen.has(value as object)) {
      throw new SunhatDeploymentError(
        'INVALID_DEPLOYMENT_PLAN',
        'cyclic deployment arguments are forbidden'
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new SunhatDeploymentError(
        'INVALID_DEPLOYMENT_PLAN',
        'deployment arguments must contain only JSON objects, arrays, and primitives'
      );
    }
    seen.add(value as object);
    for (const entry of Object.values(value as Record<string, unknown>)) {
      assertSerializable(entry, seen);
    }
    seen.delete(value as object);
    return;
  }
  throw new SunhatDeploymentError(
    'INVALID_DEPLOYMENT_PLAN',
    `deployment arguments contain unsupported ${typeof value}`
  );
}

function validateIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new SunhatDeploymentError(
      'UNSAFE_ARCHIVE_PATH',
      `${label} contains unsafe characters`
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
