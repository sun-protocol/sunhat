import type {
  NormalizedSunhatConfig,
  SunhatUserConfig,
} from '../config/types.js';

export interface HardhatUserConfigLike {
  readonly networks?: unknown;
  readonly sunhat?: SunhatUserConfig;
  readonly [key: string]: unknown;
}

export interface HardhatConfigLike {
  readonly [key: string]: unknown;
  readonly sunhat?: NormalizedSunhatConfig;
}

export interface HardhatConfigValidationErrorLike {
  readonly path: Array<string | number>;
  readonly message: string;
}

export interface ResolvedConfigurationVariableLike {
  get(): Promise<string>;
}

export type ConfigurationVariableResolverLike = (
  variableOrString: unknown
) => ResolvedConfigurationVariableLike;

export interface ConfigHooksLike {
  validateUserConfig(
    config: HardhatUserConfigLike
  ): Promise<HardhatConfigValidationErrorLike[]>;
  resolveUserConfig(
    userConfig: HardhatUserConfigLike,
    resolveConfigurationVariable: ConfigurationVariableResolverLike,
    next: (
      nextUserConfig: HardhatUserConfigLike,
      nextResolver: ConfigurationVariableResolverLike
    ) => Promise<HardhatConfigLike>
  ): Promise<HardhatConfigLike>;
  validateResolvedConfig(
    config: HardhatConfigLike
  ): Promise<HardhatConfigValidationErrorLike[]>;
}

export interface HardhatPluginLike {
  readonly id: string;
  readonly hookHandlers: {
    readonly config: () => Promise<{
      readonly default: () => Promise<Partial<ConfigHooksLike>>;
    }>;
  };
}
