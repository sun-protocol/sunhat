import {
  resolveCompilationTargets,
  SunhatConfigError,
} from '../config/index.js';
import type { NormalizedSunhatConfig } from '../config/index.js';
import { BuildCoordinator } from './coordinator.js';
import type {
  SolidityBuildBackend,
  TargetBuildResult,
} from './types.js';

export interface CompileTaskArguments {
  readonly all?: boolean;
  readonly force?: boolean;
  readonly target?: string;
}

export interface CompileTaskEnvironment {
  readonly config: {
    readonly paths: { readonly root: string };
    readonly sunhat: NormalizedSunhatConfig;
  };
  readonly globalOptions: { readonly network?: string };
  readonly userConfig?: { readonly solidity?: unknown };
}

/** Runs every selected target sequentially to keep compiler cache writes deterministic. */
export async function runCompileTask(
  arguments_: CompileTaskArguments,
  environment: CompileTaskEnvironment,
  solidity: SolidityBuildBackend
): Promise<readonly TargetBuildResult[]> {
  if (environment.userConfig?.solidity !== undefined) {
    throw new SunhatConfigError(
      'INVALID_CONFIG',
      'solidity',
      'remove native Solidity config; Sunhat compilation targets are the ' +
        'only compiler configuration source'
    );
  }
  const targets = resolveCompilationTargets(environment.config.sunhat, {
    all: arguments_.all,
    network: environment.globalOptions.network,
    target: arguments_.target,
  });
  const coordinator = new BuildCoordinator({ solidity });
  const results: TargetBuildResult[] = [];
  for (const selected of targets) {
    results.push(
      await coordinator.build({
        force: arguments_.force,
        projectRoot: environment.config.paths.root,
        target: selected.target,
        targetName: selected.name,
      })
    );
  }
  return Object.freeze(results);
}
