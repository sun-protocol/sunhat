import type { TronWeb } from 'tronweb';
import type {
  EthereumProvider,
  RequestArguments,
} from 'hardhat/types/providers';

export interface SnapshotRestorer {
  readonly snapshotId: string | number;
  restore(): Promise<void>;
}
export interface TreHelpers {
  loadFixture<T>(fixture: () => Promise<T>): Promise<T>;
  takeSnapshot(): Promise<SnapshotRestorer>;
  mine(blocks?: number): Promise<void>;
  mineUpTo(block: number | bigint): Promise<void>;
  time: {
    latest(): Promise<number>;
    latestBlock(): Promise<number>;
    increase(seconds: number): Promise<void>;
    increaseTo(timestamp: number): Promise<void>;
    setNextBlockTimestamp(timestamp: number): Promise<void>;
  };
  setBalance(
    address: string,
    value: bigint | string | number,
  ): Promise<unknown>;
  setCode(address: string, code: string): Promise<unknown>;
  setStorageAt(address: string, slot: string, value: string): Promise<unknown>;
  impersonateAccount(address: string): Promise<void>;
  stopImpersonatingAccount(address: string): Promise<void>;
}
export interface TreRuntime {
  readonly helpers: TreHelpers;
  instanceId(): Promise<string>;
  makeTronWeb(): { tronWeb: TronWeb; address: string };
}
export interface RuntimeContext {
  config: {
    paths: { root: string; artifacts: string };
    tre: { fundSigners: boolean };
  };
  network: {
    name: string;
    config: {
      tron: true;
      url: string;
      accounts: string[];
      httpHeaders?: Record<string, string>;
      timeout?: number;
    };
    provider: Pick<EthereumProvider, 'request'>;
  };
  ethers?: object;
}
export interface LifecycleConfig {
  httpHeaders?: Record<string, string>;
  image: string;
  port: number;
  readinessTimeoutMs: number;
  keepRunning: boolean;
  containerName?: string;
  jarPath?: string;
  startupEnv: Record<string, string>;
}
export interface Lifecycle {
  ensureUp(
    config: LifecycleConfig,
    url: string,
    log?: (message: string) => void,
  ): Promise<{ spawned: boolean; name: string | null; url: string }>;
  teardown(name: string | null): void;
  isReachable(
    url: string,
    timeoutMs?: number,
    httpHeaders?: Record<string, string>,
  ): Promise<boolean>;
}
export function createRuntime(context: RuntimeContext): {
  ethers: Readonly<Record<string, unknown>>;
  tre: TreRuntime;
  helpers: TreHelpers;
  request(
    args: RequestArguments,
    forward: (args: RequestArguments) => Promise<unknown>,
  ): Promise<unknown>;
};
export function createLifecycle(): Lifecycle;
export function createCompiler(options?: { cacheDir?: string }): {
  getCompiler(
    version: string,
    options: { mirror: string },
  ): Promise<{ compilerPath: string; version: string; longVersion: string }>;
};

export function registerMatchers(): void;
