import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { canonicalJson, validateSnapshot } from '../build/index.js';
import {
  archiveVerification,
  assertArchiveDestinationWritable,
  loadSnapshotArtifact,
} from './archive.js';
import { DeploymentAttemptStore } from './attempt-store.js';
import { SunhatDeploymentError } from './errors.js';
import { networkKey } from './network-key.js';
import {
  collectCreationLinkReferences,
  collectMutableReferences,
  compareRuntimeCode,
} from './runtime-match.js';
import type {
  DeploymentAttempt,
  DeploymentPlan,
  DeploymentReceipt,
  DeploymentResult,
  NetworkAdapter,
  NetworkIdentity,
  RuntimeMatchResult,
} from './types.js';
import type { VerificationSourceMode } from '../config/index.js';

export interface DeploymentManagerOptions {
  readonly adapter: NetworkAdapter;
  readonly outputDirectory?: string;
  readonly projectRoot: string;
  readonly sourceMode?: VerificationSourceMode;
}

export class DeploymentManager {
  readonly #adapter: NetworkAdapter;
  readonly #attempts: DeploymentAttemptStore;
  readonly #outputDirectory?: string;
  readonly #projectRoot: string;
  readonly #sourceMode: VerificationSourceMode;

  public constructor(options: DeploymentManagerOptions) {
    this.#adapter = options.adapter;
    this.#projectRoot = path.resolve(options.projectRoot);
    this.#attempts = new DeploymentAttemptStore(this.#projectRoot);
    this.#outputDirectory = options.outputDirectory;
    this.#sourceMode = options.sourceMode ?? 'multi-file';
  }

  public async deploy(plan: DeploymentPlan): Promise<DeploymentResult> {
    const network = await this.validatePlan(plan);
    const key = networkKey(network);
    await assertArchiveDestinationWritable(
      this.#projectRoot,
      key,
      this.#outputDirectory
    );
    const transaction = await this.#adapter.prepareDeployment(plan);
    validatePreparedTransaction(transaction);
    let attempt = await this.#attempts.create(plan, network, key, transaction);
    if (attempt.status !== 'prepared') {
      throw new SunhatDeploymentError(
        'ATTEMPT_CONFLICT',
        `deployment attempt ${attempt.attemptId} already reached ${attempt.status}; use verification sync`
      );
    }

    let transactionId: string;
    try {
      const broadcast = await this.#adapter.broadcast(transaction);
      if (!broadcast.transactionId.trim()) {
        throw new Error('adapter returned an empty transaction id');
      }
      transactionId = broadcast.transactionId;
      attempt = await this.#attempts.update(attempt, {
        status: 'broadcast',
        transactionId,
      });
    } catch (error) {
      const recoverableId = transaction.transactionId;
      attempt = await this.#attempts.update(attempt, {
        error: errorMessage(error),
        status: 'pending',
        ...(recoverableId === undefined ? {} : { transactionId: recoverableId }),
      });
      throw new SunhatDeploymentError(
        'BROADCAST_UNKNOWN',
        `deployment broadcast outcome is unknown; do not resend attempt ${attempt.attemptId}`,
        {
          attemptId: attempt.attemptId,
          recoveryId: transaction.recoveryId,
          ...(recoverableId === undefined ? {} : { transactionId: recoverableId }),
        }
      );
    }
    return this.finalize(attempt, transactionId);
  }

  public async sync(attemptId: string): Promise<DeploymentResult> {
    const network = await this.#adapter.getNetworkIdentity();
    if (network.chain !== this.#adapter.chain) {
      throw new SunhatDeploymentError(
        'NETWORK_IDENTITY_MISMATCH',
        'adapter chain and reported network chain differ'
      );
    }
    const key = networkKey(network);
    const attempt = await this.#attempts.read(key, attemptId);
    if (canonicalJson(attempt.network) !== canonicalJson(network)) {
      throw new SunhatDeploymentError(
        'NETWORK_IDENTITY_MISMATCH',
        `attempt ${attemptId} belongs to a different network instance`
      );
    }
    const transactionId = attempt.transactionId ?? attempt.transaction.transactionId;
    if (transactionId === undefined) {
      throw new SunhatDeploymentError(
        'BROADCAST_UNKNOWN',
        `attempt ${attemptId} has no transaction id; recover it by ${attempt.transaction.recoveryId}`
      );
    }
    await validateSnapshot(attempt.snapshotDirectory, attempt.buildId);
    return this.finalize(attempt, transactionId);
  }

  public async syncByTransactionId(
    transactionId: string
  ): Promise<DeploymentResult> {
    if (!transactionId.trim()) {
      invalid('transaction id is required for verification sync');
    }
    const network = await this.#adapter.getNetworkIdentity();
    if (network.chain !== this.#adapter.chain) {
      throw new SunhatDeploymentError(
        'NETWORK_IDENTITY_MISMATCH',
        'adapter chain and reported network chain differ'
      );
    }
    const attempt = await this.#attempts.findByTransactionId(
      networkKey(network),
      transactionId
    );
    return this.sync(attempt.attemptId);
  }

  private async validatePlan(plan: DeploymentPlan): Promise<NetworkIdentity> {
    if (path.resolve(plan.projectRoot) !== this.#projectRoot) {
      invalid('plan project root differs from manager project root');
    }
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(plan.target)) {
      invalid('target name contains unsafe characters');
    }
    if (!/^[a-f0-9]{64}$/.test(plan.buildId)) {
      invalid('buildId must be a lowercase SHA-256 digest');
    }
    if (!isHex(plan.initCode) || !isHex(plan.encodedConstructorArguments)) {
      invalid('init code and encoded constructor arguments must be hexadecimal');
    }
    if (
      plan.confirmations !== undefined &&
      (!Number.isSafeInteger(plan.confirmations) || plan.confirmations < 0)
    ) {
      invalid('confirmations must be a non-negative safe integer');
    }
    if (!/^(0|[1-9][0-9]*)$/.test(plan.value ?? '0')) {
      invalid('deployment value must be an unsigned decimal string');
    }
    const expectedSnapshot = path.join(
      this.#projectRoot,
      'build-snapshots',
      plan.target,
      plan.buildId
    );
    let canonicalSnapshot: string;
    let canonicalExpectedSnapshot: string;
    try {
      [canonicalSnapshot, canonicalExpectedSnapshot] = await Promise.all([
        realpath(plan.snapshotDirectory),
        realpath(expectedSnapshot),
      ]);
    } catch {
      throw new SunhatDeploymentError(
        'SNAPSHOT_MISMATCH',
        `deployment snapshot does not exist at ${expectedSnapshot}`
      );
    }
    if (canonicalSnapshot !== canonicalExpectedSnapshot) {
      throw new SunhatDeploymentError(
        'SNAPSHOT_MISMATCH',
        `deployment must use canonical snapshot ${expectedSnapshot}`
      );
    }
    const manifest = await validateSnapshot(canonicalExpectedSnapshot, plan.buildId);
    if (manifest.target !== plan.target) {
      throw new SunhatDeploymentError(
        'SNAPSHOT_MISMATCH',
        `snapshot target ${manifest.target} does not match ${plan.target}`
      );
    }
    const snapshotArtifact = await loadSnapshotArtifact(
      canonicalExpectedSnapshot,
      plan.fullyQualifiedName
    );
    assertInitCodeMatchesArtifact(plan, snapshotArtifact.artifact);
    const sourceName = plan.fullyQualifiedName.slice(
      0,
      plan.fullyQualifiedName.lastIndexOf(':')
    );
    if (sourceName.endsWith('.vy') && this.#sourceMode === 'flatten') {
      throw new SunhatDeploymentError(
        'INVALID_DEPLOYMENT_PLAN',
        'Vyper does not support flattened source export; use multi-file or both'
      );
    }
    const network = await this.#adapter.getNetworkIdentity();
    if (network.chain !== this.#adapter.chain || network.chain !== manifest.chain) {
      throw new SunhatDeploymentError(
        'NETWORK_IDENTITY_MISMATCH',
        `snapshot chain ${manifest.chain} cannot deploy through ${network.chain} adapter`
      );
    }
    networkKey(network);
    return network;
  }

  private async finalize(
    inputAttempt: DeploymentAttempt,
    transactionId: string
  ): Promise<DeploymentResult> {
    let attempt = inputAttempt;
    let receipt: DeploymentReceipt;
    try {
      receipt = await this.#adapter.getReceipt(
        transactionId,
        attempt.confirmations
      );
    } catch (error) {
      await this.#attempts.update(attempt, {
        error: errorMessage(error),
        status: 'pending',
        transactionId,
      });
      throw new SunhatDeploymentError(
        'RECEIPT_PENDING',
        `cannot establish finality for ${transactionId}; run verification sync later`,
        { attemptId: attempt.attemptId, transactionId }
      );
    }
    if (receipt.transactionId !== transactionId) {
      throw new SunhatDeploymentError(
        'NETWORK_IDENTITY_MISMATCH',
        'adapter returned a receipt for a different transaction'
      );
    }
    if (
      receipt.status === 'pending' ||
      receipt.status === 'unknown' ||
      receipt.confirmations < attempt.confirmations
    ) {
      await this.#attempts.update(attempt, {
        receipt,
        status: 'pending',
        transactionId,
      });
      throw new SunhatDeploymentError(
        'RECEIPT_PENDING',
        `transaction ${transactionId} is not final; run verification sync later`,
        { attemptId: attempt.attemptId, transactionId }
      );
    }
    if (receipt.status === 'failure' || receipt.address === undefined) {
      await this.#attempts.update(attempt, {
        receipt,
        status: 'failed',
        transactionId,
      });
      throw new SunhatDeploymentError(
        'RECEIPT_FAILED',
        `deployment transaction ${transactionId} failed; no verification archive was created`,
        { attemptId: attempt.attemptId, transactionId }
      );
    }
    attempt = await this.#attempts.update(attempt, {
      receipt,
      status: 'executed',
      transactionId,
    });
    let runtimeMatch: RuntimeMatchResult;
    let verificationDirectory: string;
    try {
      const onchain = await this.#adapter.getCode(receipt.address);
      const snapshotArtifact = await loadSnapshotArtifact(
        attempt.snapshotDirectory,
        attempt.deployment.fullyQualifiedName
      );
      const expectedRuntime = readRuntimeCode(snapshotArtifact.artifact);
      runtimeMatch = compareRuntimeCode(
        expectedRuntime,
        onchain.code,
        collectMutableReferences(snapshotArtifact.artifact)
      );
      verificationDirectory = await archiveVerification({
        attempt,
        onchain,
        outputDirectory: this.#outputDirectory,
        receipt,
        runtimeMatch,
        sourceMode: this.#sourceMode,
      });
      attempt = await this.#attempts.update(attempt, {
        receipt,
        status: 'archived',
        transactionId,
        verificationDirectory,
      });
    } catch (error) {
      await this.#attempts.update(attempt, {
        error: errorMessage(error),
        receipt,
        status: 'archive-failed',
        transactionId,
      });
      throw new SunhatDeploymentError(
        'ARCHIVE_FAILED',
        `contract deployed but verification archive failed; run verification sync ${attempt.attemptId}`,
        {
          address: receipt.address,
          attemptId: attempt.attemptId,
          transactionId,
        }
      );
    }
    if (runtimeMatch.status === 'mismatch') {
      throw new SunhatDeploymentError(
        'RUNTIME_MISMATCH',
        `deployed runtime does not match snapshot artifact at ${receipt.address}`,
        {
          address: receipt.address,
          attemptId: attempt.attemptId,
          transactionId,
          verificationDirectory,
        }
      );
    }
    return {
      address: receipt.address,
      attemptId: attempt.attemptId,
      networkKey: attempt.networkKey,
      runtimeMatch,
      transactionId,
      verificationDirectory,
    };
  }

}

function validatePreparedTransaction(transaction: {
  readonly data: string;
  readonly from: string;
  readonly recoveryId: string;
  readonly value: string;
}): void {
  if (!isHex(transaction.data) || !transaction.from || !transaction.recoveryId) {
    invalid('adapter returned an invalid prepared transaction');
  }
  if (!/^(0|[1-9][0-9]*)$/.test(transaction.value)) {
    invalid('adapter returned a non-decimal transaction value');
  }
}

function readRuntimeCode(artifact: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof artifact.deployedBytecode === 'string') {
    return artifact.deployedBytecode;
  }
  if (
    artifact.deployedBytecode !== null &&
    typeof artifact.deployedBytecode === 'object'
  ) {
    const object = artifact.deployedBytecode as Record<string, unknown>;
    if (typeof object.object === 'string') return object.object;
  }
  return undefined;
}

function assertInitCodeMatchesArtifact(
  plan: DeploymentPlan,
  artifact: Readonly<Record<string, unknown>>
): void {
  const expected = readBytecode(artifact.bytecode);
  if (expected === undefined) {
    throw new SunhatDeploymentError(
      'SNAPSHOT_MISMATCH',
      `artifact for ${plan.fullyQualifiedName} has no creation bytecode`
    );
  }
  const initCode = stripHexPrefix(plan.initCode);
  const arguments_ = stripHexPrefix(plan.encodedConstructorArguments);
  if (
    initCode.length < arguments_.length ||
    !initCode.toLowerCase().endsWith(arguments_.toLowerCase())
  ) {
    throw new SunhatDeploymentError(
      'SNAPSHOT_MISMATCH',
      'deployment initcode does not end with the encoded constructor arguments'
    );
  }
  let observedCreation = initCode.slice(0, initCode.length - arguments_.length);
  let expectedCreation = stripHexPrefix(expected);
  if (expectedCreation.length !== observedCreation.length) {
    throw new SunhatDeploymentError(
      'SNAPSHOT_MISMATCH',
      'deployment initcode length does not match the snapshot artifact'
    );
  }
  for (const reference of collectCreationLinkReferences(artifact)) {
    const start = reference.start * 2;
    const length = reference.length * 2;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      length <= 0 ||
      start + length > expectedCreation.length
    ) {
      throw new SunhatDeploymentError(
        'SNAPSHOT_MISMATCH',
        'artifact contains an invalid creation-bytecode link range'
      );
    }
    const zeros = '0'.repeat(length);
    expectedCreation = replaceRange(expectedCreation, start, length, zeros);
    observedCreation = replaceRange(observedCreation, start, length, zeros);
  }
  if (
    !/^[a-fA-F0-9]*$/.test(expectedCreation) ||
    expectedCreation.toLowerCase() !== observedCreation.toLowerCase()
  ) {
    throw new SunhatDeploymentError(
      'SNAPSHOT_MISMATCH',
      'deployment initcode does not match artifact bytecode outside declared link ranges'
    );
  }
}

function readBytecode(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (typeof object.object === 'string') return object.object;
  }
  return undefined;
}

function replaceRange(
  value: string,
  start: number,
  length: number,
  replacement: string
): string {
  return `${value.slice(0, start)}${replacement}${value.slice(start + length)}`;
}

function stripHexPrefix(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value;
}

function isHex(value: string): boolean {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  return normalized.length % 2 === 0 && /^[a-fA-F0-9]*$/.test(normalized);
}

function invalid(message: string): never {
  throw new SunhatDeploymentError('INVALID_DEPLOYMENT_PLAN', message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
