import type { ChainKind } from '../config/index.js';

export type DecimalString = `${number}` | string;

export interface NetworkIdentity {
  readonly chain: ChainKind;
  readonly chainId: string;
  readonly genesisHash?: string;
  readonly instanceId?: string;
  readonly name: string;
}

export interface DeploymentTransaction {
  readonly data: string;
  readonly from: string;
  readonly method: 'create' | 'create2' | 'factory';
  readonly nonce?: DecimalString;
  readonly recoveryId: string;
  readonly to?: string;
  readonly transactionId?: string;
  readonly value: DecimalString;
}

export interface BroadcastResult {
  readonly transactionId: string;
}

export interface DeploymentReceipt {
  readonly address?: string;
  readonly blockHash?: string;
  readonly blockNumber?: DecimalString;
  readonly confirmations: number;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly status: 'pending' | 'success' | 'failure' | 'unknown';
  readonly transactionId: string;
}

export interface OnchainCode {
  readonly address: string;
  readonly code: string;
  readonly queriedBlockHash?: string;
  readonly queriedBlockNumber?: DecimalString;
}

export interface NetworkAdapter {
  readonly chain: ChainKind;
  getNetworkIdentity(): Promise<NetworkIdentity>;
  prepareDeployment(plan: DeploymentPlan): Promise<DeploymentTransaction>;
  broadcast(transaction: DeploymentTransaction): Promise<BroadcastResult>;
  getReceipt(
    transactionId: string,
    confirmations: number
  ): Promise<DeploymentReceipt>;
  getCode(address: string): Promise<OnchainCode>;
}

export interface DeploymentPlan {
  readonly buildId: string;
  readonly confirmations?: number;
  readonly constructorArguments: readonly unknown[];
  readonly encodedConstructorArguments: string;
  readonly expectedRuntimeCode?: string;
  readonly fullyQualifiedName: string;
  readonly initCode: string;
  readonly libraries?: Readonly<Record<string, string>>;
  readonly projectRoot: string;
  readonly snapshotDirectory: string;
  readonly target: string;
  readonly value?: DecimalString;
}

export type DeploymentAttemptStatus =
  | 'prepared'
  | 'broadcast'
  | 'pending'
  | 'executed'
  | 'archive-failed'
  | 'archived'
  | 'failed';

export interface DeploymentAttempt {
  readonly schema: 'sunhat-deployment-attempt-1';
  readonly attemptId: string;
  readonly buildId: string;
  readonly confirmations: number;
  readonly createdAt: string;
  readonly deployment: {
    readonly constructorArguments: readonly unknown[];
    readonly encodedConstructorArguments: string;
    readonly fullyQualifiedName: string;
    readonly initCode: string;
    readonly libraries: Readonly<Record<string, string>>;
    readonly target: string;
    readonly value: DecimalString;
  };
  readonly error?: string;
  readonly network: NetworkIdentity;
  readonly networkKey: string;
  readonly observations: readonly DeploymentReceipt[];
  readonly projectRoot: string;
  readonly receipt?: DeploymentReceipt;
  readonly snapshotDirectory: string;
  readonly status: DeploymentAttemptStatus;
  readonly transaction: DeploymentTransaction;
  readonly transactionId?: string;
  readonly updatedAt: string;
  readonly verificationDirectory?: string;
}

export type RuntimeMatchStatus =
  | 'exact'
  | 'normalized'
  | 'mismatch'
  | 'insufficient';

export interface RuntimeMatchResult {
  readonly expectedCodeHash?: string;
  readonly observedCodeHash: string;
  readonly reason?: string;
  readonly status: RuntimeMatchStatus;
}

export interface VerificationFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface VerificationManifest {
  readonly schema: 'sunhat-verification-1';
  readonly address: string;
  readonly archiveState: 'complete';
  readonly buildId: string;
  readonly chain: ChainKind;
  readonly files: readonly VerificationFile[];
  readonly fullyQualifiedName: string;
  readonly generatedAt: string;
  readonly language: 'solidity' | 'vyper';
  readonly network: NetworkIdentity;
  readonly networkKey: string;
  readonly flattenStatus?: 'unverified-export';
  readonly sourceMode: 'multi-file' | 'flatten' | 'both';
  readonly target: string;
  readonly transactionId: string;
}

export interface DeploymentResult {
  readonly address: string;
  readonly attemptId: string;
  readonly networkKey: string;
  readonly runtimeMatch: RuntimeMatchResult;
  readonly transactionId: string;
  readonly verificationDirectory: string;
}
