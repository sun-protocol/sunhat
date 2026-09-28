import path from 'node:path';
import { SunhatConfigError, normalizeSunhatConfig } from '../config/index.js';
import type { SunhatConfigurationVariable } from '../config/index.js';
import type {
  ConfigHooksLike,
  ConfigurationVariableResolverLike,
  HardhatConfigLike,
  HardhatConfigValidationErrorLike,
  HardhatUserConfigLike,
} from './contracts.js';

const VARIABLE_PATH_PLACEHOLDER = '/__sunhat_configuration_variable__';
const VARIABLE_SHA256_PLACEHOLDER = '0'.repeat(64);

export default async function createConfigHooks(): Promise<
  Partial<ConfigHooksLike>
> {
  return {
    validateUserConfig: async (userConfig) =>
      validateSunhatUserConfig(userConfig),
    resolveUserConfig: async (
      userConfig,
      resolveConfigurationVariable,
      next
    ) => {
      const resolvedConfig = await next(
        userConfig,
        resolveConfigurationVariable
      );
      const resolvedSunhat = await resolveSunhatConfigurationVariables(
        userConfig.sunhat,
        resolveConfigurationVariable
      );
      const sunhat = normalizeSunhatConfig(
        resolvedSunhat,
        userConfig.networks
      );
      const configuredArtifactPath =
        userConfig.solidity === undefined
          ? testArtifactPath(resolvedConfig, sunhat)
          : undefined;
      return {
        ...resolvedConfig,
        ...(configuredArtifactPath === undefined
          ? {}
          : {
              paths: {
                ...(resolvedConfig.paths as Record<string, unknown>),
                artifacts: configuredArtifactPath,
              },
            }),
        sunhat,
      };
    },
    validateResolvedConfig: async (resolvedConfig) => {
      if (resolvedConfig.sunhat === undefined) {
        return [
          {
            path: ['sunhat'],
            message: 'Sunhat config was not resolved',
          },
        ];
      }
      return [];
    },
  };
}

function testArtifactPath(
  resolvedConfig: HardhatConfigLike,
  sunhat: ReturnType<typeof normalizeSunhatConfig>
): string | undefined {
  const paths = readRecord(resolvedConfig.paths);
  if (typeof paths?.root !== 'string') return undefined;
  const evmTargetNames = Object.entries(sunhat.compilation.targets)
    .filter(([, target]) => target.chain === 'evm')
    .map(([name]) => name);
  const targetName =
    sunhat.test.target ??
    (evmTargetNames.length === 1 ? evmTargetNames[0] : undefined);
  if (targetName === undefined) return undefined;
  return path.join(paths.root, 'artifacts', 'sunhat', targetName, 'solidity');
}

export function validateSunhatUserConfig(
  userConfig: HardhatUserConfigLike
): HardhatConfigValidationErrorLike[] {
  try {
    normalizeSunhatConfig(
      replaceConfigurationVariablesForValidation(userConfig.sunhat),
      userConfig.networks
    );
    return [];
  } catch (error) {
    if (error instanceof SunhatConfigError) {
      return [
        {
          path: parseConfigPath(error.configPath),
          message: error.message.slice(error.configPath.length + 2),
        },
      ];
    }
    throw error;
  }
}

export async function resolveSunhatConfigurationVariables(
  rawSunhat: unknown,
  resolver: ConfigurationVariableResolverLike
): Promise<unknown> {
  if (!isRecord(rawSunhat)) {
    return rawSunhat;
  }
  const sunhat = { ...rawSunhat };
  if (!isRecord(rawSunhat.compilation)) {
    return sunhat;
  }
  const compilation = { ...rawSunhat.compilation };
  sunhat.compilation = compilation;
  if (!isRecord(rawSunhat.compilation.targets)) {
    return sunhat;
  }
  const targets: Record<string, unknown> = {
    ...rawSunhat.compilation.targets,
  };
  compilation.targets = targets;

  for (const [targetName, rawTarget] of Object.entries(targets)) {
    if (!isRecord(rawTarget) || !Array.isArray(rawTarget.compilers)) {
      continue;
    }
    const target = { ...rawTarget };
    targets[targetName] = target;
    target.compilers = await Promise.all(
      rawTarget.compilers.map(async (rawCompiler) => {
        if (!isRecord(rawCompiler)) {
          return rawCompiler;
        }
        const compiler = { ...rawCompiler };
        compiler.path = await resolveSensitiveString(compiler.path, resolver);
        compiler.sha256 = await resolveSensitiveString(compiler.sha256, resolver);
        return compiler;
      })
    );
  }
  return sunhat;
}

function replaceConfigurationVariablesForValidation(rawSunhat: unknown): unknown {
  if (!isRecord(rawSunhat)) {
    return rawSunhat;
  }
  const sunhat = structuredCloneWithoutVariables(rawSunhat);
  const compilation = readRecord(sunhat.compilation);
  const targets = readRecord(compilation?.targets);
  if (targets === undefined) {
    return sunhat;
  }
  for (const rawTarget of Object.values(targets)) {
    const target = readRecord(rawTarget);
    if (target === undefined || !Array.isArray(target.compilers)) {
      continue;
    }
    for (const rawCompiler of target.compilers) {
      const compiler = readRecord(rawCompiler);
      if (compiler === undefined) {
        continue;
      }
      if (isConfigurationVariable(compiler.path)) {
        compiler.path = VARIABLE_PATH_PLACEHOLDER;
      }
      if (isConfigurationVariable(compiler.sha256)) {
        compiler.sha256 = VARIABLE_SHA256_PLACEHOLDER;
      }
    }
  }
  return sunhat;
}

function structuredCloneWithoutVariables(
  value: Record<string, unknown>
): Record<string, unknown> {
  const clone: Record<string, unknown> = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) {
      clone[key] = child.map((item) =>
        isRecord(item) && !isConfigurationVariable(item)
          ? structuredCloneWithoutVariables(item)
          : item
      );
    } else if (isRecord(child) && !isConfigurationVariable(child)) {
      clone[key] = structuredCloneWithoutVariables(child);
    } else {
      clone[key] = child;
    }
  }
  return clone;
}

async function resolveSensitiveString(
  value: unknown,
  resolver: ConfigurationVariableResolverLike
): Promise<unknown> {
  if (!isConfigurationVariable(value)) {
    return value;
  }
  return resolver(value).get();
}

function isConfigurationVariable(
  value: unknown
): value is SunhatConfigurationVariable {
  return (
    isRecord(value) &&
    value._type === 'ConfigurationVariable' &&
    typeof value.name === 'string'
  );
}

function parseConfigPath(configPath: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const pattern = /([^.\[\]]+)|\[(\d+)\]/g;
  for (const match of configPath.matchAll(pattern)) {
    segments.push(match[2] === undefined ? match[1] : Number(match[2]));
  }
  return segments;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
