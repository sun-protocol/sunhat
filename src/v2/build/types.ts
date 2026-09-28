import type {
  NormalizedCompilationTarget,
  NormalizedCompilerConfig,
} from '../config/index.js';
import type { BuildDiagnostic } from './errors.js';

export type SourceLanguage = 'solidity' | 'vyper' | 'vyper-interface' | 'json';

export interface BuildSource {
  readonly absolutePath: string;
  readonly content: string;
  readonly language: SourceLanguage;
  readonly sha256: string;
  readonly sourceName: string;
}

export interface SolidityBuildRequest {
  readonly artifactDirectory: string;
  readonly cacheDirectory: string;
  readonly compilerKind: 'solc' | 'tron-solc';
  readonly compilers: readonly NormalizedCompilerConfig[];
  readonly force: boolean;
  readonly overrides: Readonly<Record<string, string>>;
  readonly projectRoot: string;
  readonly sourceDirectories: readonly string[];
  readonly sources: readonly BuildSource[];
  readonly targetName: string;
}

export interface BackendBuildResult {
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface SolidityBuildBackend {
  build(request: SolidityBuildRequest): Promise<BackendBuildResult>;
  fingerprint?(
    request: SolidityBuildRequest
  ): Promise<SolidityBuildFingerprint>;
}

export interface SolidityBuildFingerprint {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sources: readonly BuildSource[];
}

export interface TargetBuildRequest {
  readonly force?: boolean;
  readonly projectRoot: string;
  readonly target: NormalizedCompilationTarget;
  readonly targetName: string;
}

export interface TargetBuildResult {
  readonly artifactDirectory: string;
  readonly buildId: string;
  readonly cacheHit: boolean;
  readonly snapshotDirectory: string;
  readonly sources: readonly BuildSource[];
  readonly targetName: string;
}

export interface BuildManifestFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface BuildCompilerIdentity {
  readonly id: string;
  readonly kind: 'solc' | 'tron-solc' | 'vyper';
  readonly settings: Readonly<Record<string, unknown>>;
  readonly sha256?: string;
  readonly version: string;
}

export interface BuildSourceIdentity {
  readonly sha256: string;
  readonly sourceName: string;
}

export interface BuildIdentity {
  readonly schema: 'sunhat-build-identity-2';
  readonly chain: 'evm' | 'tron';
  readonly compilers: readonly BuildCompilerIdentity[];
  readonly overrides: Readonly<Record<string, string>>;
  readonly solidityFingerprint?: Readonly<Record<string, unknown>>;
  readonly sources: readonly BuildSourceIdentity[];
  readonly target: string;
}

export interface BuildManifest {
  readonly schema: 'sunhat-build-snapshot-2';
  readonly buildId: string;
  readonly build: BuildIdentity;
  readonly files: readonly BuildManifestFile[];
}
