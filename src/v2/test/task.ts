import {
  BuildCoordinator,
} from '../build/index.js';
import type {
  CompileTaskEnvironment,
  SolidityBuildBackend,
} from '../build/index.js';
import {
  resolveTestTarget,
  SunhatConfigError,
} from '../config/index.js';
import type {
  SunhatTestArguments,
  SunhatTestResult,
  TestRunnerArguments,
} from './types.js';

export async function runSunhatTestTask<RunnerResult>(
  arguments_: SunhatTestArguments,
  environment: CompileTaskEnvironment,
  solidity: SolidityBuildBackend,
  runTests: (arguments_: TestRunnerArguments) => Promise<RunnerResult>
): Promise<SunhatTestResult<RunnerResult>> {
  if (environment.userConfig?.solidity !== undefined) {
    throw new SunhatConfigError(
      'INVALID_CONFIG',
      'solidity',
      'remove native Solidity config; Sunhat compilation targets are the ' +
        'only compiler configuration source'
    );
  }
  const selected = resolveTestTarget(environment.config.sunhat, {
    network: environment.globalOptions.network,
    target: arguments_.target,
  });
  const build = await new BuildCoordinator({ solidity }).build({
    force: arguments_.force,
    projectRoot: environment.config.paths.root,
    target: selected.target,
    targetName: selected.name,
  });
  const runnerResult = await runTests({
    ...(arguments_.grep === undefined ? {} : { grep: arguments_.grep }),
    ...(arguments_.grepExclude === undefined
      ? {}
      : { grepExclude: arguments_.grepExclude }),
    noCompile: true,
    testFiles: Object.freeze([...(arguments_.testFiles ?? [])]),
  });
  return Object.freeze({ build, runnerResult });
}
