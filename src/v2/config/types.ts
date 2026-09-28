export type ChainKind = 'evm' | 'tron';

export type CompilerKind = 'solc' | 'tron-solc' | 'vyper';

export type VerificationSourceMode = 'multi-file' | 'flatten' | 'both';

/**
 * Structural subset of Hardhat 3's ConfigurationVariable.
 *
 * Keeping this type local lets the P1 modules coexist with the Hardhat 2 root
 * package until the 2.x package boundary is switched to ESM.
 */
export interface SunhatConfigurationVariable {
  readonly _type: 'ConfigurationVariable';
  readonly name: string;
  readonly format?: string;
  readonly default?: string;
}

export type SunhatSensitiveString = string | SunhatConfigurationVariable;

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface CompilerUserConfig {
  id: string;
  kind: CompilerKind;
  version: string;
  path?: SunhatSensitiveString;
  sha256?: SunhatSensitiveString;
  settings?: unknown;
}

export interface CompilationTargetUserConfig {
  chain: ChainKind;
  sources: string[];
  compilers: CompilerUserConfig[];
  overrides?: Record<string, string>;
}

export interface SunhatUserConfig {
  compilation?: {
    defaultTarget?: string;
    targets?: Record<string, CompilationTargetUserConfig>;
  };
  test?: {
    target?: string;
  };
  verification?: {
    outputDir?: string;
    sourceMode?: VerificationSourceMode;
    autoExport?: boolean;
  };
}

export interface HardhatNetworkUserConfig {
  type?: string;
  chainType?: string;
  sunhat?: {
    target?: string;
  };
}

export interface NormalizedCompilerConfig {
  readonly id: string;
  readonly kind: CompilerKind;
  readonly version: string;
  readonly path?: string;
  readonly sha256?: string;
  readonly settings: JsonObject;
}

export interface NormalizedCompilationTarget {
  readonly chain: ChainKind;
  readonly sources: readonly string[];
  readonly compilers: readonly NormalizedCompilerConfig[];
  readonly overrides: Readonly<Record<string, string>>;
}

export interface NormalizedNetworkBinding {
  readonly name: string;
  readonly type?: string;
  readonly chainType?: string;
  readonly target?: string;
}

export interface NormalizedSunhatConfig {
  readonly compilation: {
    readonly defaultTarget?: string;
    readonly targets: Readonly<Record<string, NormalizedCompilationTarget>>;
  };
  readonly test: {
    readonly target?: string;
  };
  readonly verification: {
    readonly outputDir: string;
    readonly sourceMode: VerificationSourceMode;
    readonly autoExport: boolean;
  };
  readonly networks: Readonly<Record<string, NormalizedNetworkBinding>>;
}

export type TargetSelectionReason =
  | 'all'
  | 'default-target'
  | 'explicit-network'
  | 'explicit-target'
  | 'single-target'
  | 'test-target'
  | 'unique-evm-target';

export interface ResolvedTarget {
  readonly name: string;
  readonly target: NormalizedCompilationTarget;
  readonly network?: string;
  readonly reason: TargetSelectionReason;
}
