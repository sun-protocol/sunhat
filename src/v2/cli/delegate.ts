import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { SunhatCliError } from './errors.js';
import {
  locateProject,
  readConfigArgument,
  resolveProjectRuntime,
} from './project.js';

export const LOCAL_DELEGATION_ENV = 'SUNHAT_LOCAL_CLI_ROOT';

export interface DelegateOptions {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
}

export async function delegateToProjectLocalCli(
  options: DelegateOptions
): Promise<number> {
  const env = options.env ?? process.env;
  if (env[LOCAL_DELEGATION_ENV] !== undefined) {
    throw new SunhatCliError(
      'CLI_RECURSION',
      'project-local Sunhat attempted to delegate more than once'
    );
  }
  const configPath = readConfigArgument(options.argv);
  const project = await locateProject(options.cwd, configPath);
  const runtime = await resolveProjectRuntime(project.projectRoot);
  return spawnLocalCli(
    runtime.cliPath,
    runtime.packageRoot,
    options.argv,
    options.cwd,
    env
  );
}

export function isDelegatedLocalProcess(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[LOCAL_DELEGATION_ENV] !== undefined;
}

async function spawnLocalCli(
  cliPath: string,
  packageRoot: string,
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const child = spawn(process.execPath, [cliPath, ...argv], {
    cwd,
    env: { ...env, [LOCAL_DELEGATION_ENV]: packageRoot },
    stdio: 'inherit',
  });
  const forwardSignal = (signal: NodeJS.Signals) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };
  const onSigint = () => forwardSignal('SIGINT');
  const onSigterm = () => forwardSignal('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  try {
    return await childExitCode(child);
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }
}

async function childExitCode(child: ChildProcess): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        resolve(128 + signalNumber(signal));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function signalNumber(signal: NodeJS.Signals): number {
  if (signal === 'SIGINT') {
    return 2;
  }
  if (signal === 'SIGTERM') {
    return 15;
  }
  return 1;
}
