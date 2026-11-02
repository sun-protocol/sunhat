export type * from '@nomicfoundation/hardhat-ethers';
import type { TreRuntime } from '../../../vendor/hardhat-tron/index.js';

export interface CompilerBatch {
  name: string;
  include?: string[];
  dirs?: string[];
  extraLeaves?: string[];
}
export interface TreUserConfig {
  autoStart?: boolean;
  autoStartOnTest?: boolean;
  autoStartOnCompile?: boolean;
  autoStartOnNode?: boolean;
  keepRunning?: boolean;
  image?: string;
  port?: number;
  jarPath?: string;
  containerName?: string;
  startupEnv?: Record<string, string>;
  readinessTimeoutMs?: number;
  fundSigners?: boolean;
  matchers?: boolean;
  compiler?: {
    target?: 'auto' | 'tron' | 'evm';
    enabled?: boolean;
    path?: string;
    mirror?: string;
    cacheDir?: string;
    include?: string[];
    exclude?: string[];
    batches?: CompilerBatch[];
    batchesPath?: string;
  };
}
export interface TreConfig {
  artifactPaths?: { evm: string; tron: string };
  autoStart: boolean;
  autoStartOnTest: boolean;
  autoStartOnCompile: boolean;
  autoStartOnNode: boolean;
  keepRunning: boolean;
  image: string;
  port?: number;
  jarPath?: string;
  containerName?: string;
  startupEnv: Record<string, string>;
  readinessTimeoutMs: number;
  fundSigners: boolean;
  matchers: boolean;
  compiler: {
    target: 'tron' | 'evm';
    path?: string;
    mirror: string;
    cacheDir?: string;
    include: string[];
    exclude: string[];
    batches: CompilerBatch[];
    batchesPath?: string;
  };
}
declare module 'hardhat/types/config' {
  interface HardhatUserConfig {
    tre?: TreUserConfig;
  }
  interface HardhatConfig {
    tre?: TreConfig;
  }
  interface HttpNetworkUserConfig {
    tron?: boolean;
  }
  interface HttpNetworkConfig {
    tron?: boolean;
  }
}
declare module 'hardhat/types/network' {
  interface NetworkConnection {
    tre?: TreRuntime;
  }
}
export type {
  TreRuntime,
  TreHelpers,
  SnapshotRestorer,
} from '../../../vendor/hardhat-tron/index.js';

declare module 'ethers' {
  interface TransactionReceipt {
    readonly nativeTransactionId?: string;
    readonly nativeReceipt?: Readonly<Record<string, unknown>>;
    readonly nativeTransactionInfo?: Readonly<Record<string, unknown>>;
  }
}
