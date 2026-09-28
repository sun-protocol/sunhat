import type { TargetBuildResult } from '../build/index.js';

export interface SunhatTestArguments {
  readonly force?: boolean;
  readonly grep?: string;
  readonly grepExclude?: string;
  readonly target?: string;
  readonly testFiles?: readonly string[];
}

export interface TestRunnerArguments {
  readonly grep?: string;
  readonly grepExclude?: string;
  readonly noCompile: true;
  readonly testFiles: readonly string[];
}

export interface SunhatTestResult<RunnerResult = unknown> {
  readonly build: TargetBuildResult;
  readonly runnerResult: RunnerResult;
}
