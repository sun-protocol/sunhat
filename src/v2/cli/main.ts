import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  delegateToProjectLocalCli,
  isDelegatedLocalProcess,
  LOCAL_DELEGATION_ENV,
} from './delegate.js';
import { SunhatCliError } from './errors.js';
import {
  locateProject,
  readConfigArgument,
  resolveProjectRuntime,
} from './project.js';
import { createProjectTemplate, writeProjectTemplate } from './template.js';

export interface RunSunhatCliOptions {
  readonly argv: readonly string[];
  readonly currentVersion: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly installDependencies?: (projectRoot: string) => Promise<number>;
  readonly runHardhat?: (
    cliPath: string,
    argv: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv
  ) => Promise<number>;
}

export async function runSunhatCli(
  options: RunSunhatCliOptions
): Promise<number> {
  const env = options.env ?? process.env;
  const command = options.argv[0];
  if (command === undefined) {
    throw new SunhatCliError(
      'COMMAND_ARGUMENT_INVALID',
      'a command is required'
    );
  }

  if (command === 'init') {
    if (isDelegatedLocalProcess(env)) {
      throw new SunhatCliError(
        'CLI_RECURSION',
        'sunhat init must be handled by the first launcher process'
      );
    }
    return initializeProject(
      options.argv.slice(1),
      options.cwd,
      options.currentVersion,
      options.installDependencies ??
        ((projectRoot) => installProjectDependencies(projectRoot, env))
    );
  }

  if (!isDelegatedLocalProcess(env)) {
    return delegateToProjectLocalCli({
      argv: options.argv,
      cwd: options.cwd,
      env,
    });
  }

  const configPath = readConfigArgument(options.argv);
  const project = await locateProject(options.cwd, configPath);
  const runtime = await resolveProjectRuntime(project.projectRoot);
  await assertDelegationMarker(env, runtime.packageRoot);
  const hardhatArguments = mapHardhatArguments(options.argv);
  const runHardhat = options.runHardhat ?? spawnNodeCli;
  return runHardhat(runtime.hardhatCliPath, hardhatArguments, options.cwd, env);
}

export function mapHardhatArguments(argv: readonly string[]): readonly string[] {
  const [command, ...argumentsAfterCommand] = argv;
  if (command === 'compile' || command === 'build') {
    return ['build', ...argumentsAfterCommand];
  }
  if (command === 'test') {
    return ['test', 'mocha', ...argumentsAfterCommand];
  }
  return argv;
}

async function initializeProject(
  argv: readonly string[],
  cwd: string,
  sunhatVersion: string,
  installer: (projectRoot: string) => Promise<number>
): Promise<number> {
  let directory: string | undefined;
  let install = true;
  for (const argument of argv) {
    if (argument === '--no-install') {
      install = false;
      continue;
    }
    if (argument.startsWith('-') || directory !== undefined) {
      throw new SunhatCliError(
        'COMMAND_ARGUMENT_INVALID',
        'usage: sunhat init [directory] [--no-install]'
      );
    }
    directory = argument;
  }

  const destination = path.resolve(cwd, directory ?? '.');
  const projectName = path.basename(destination);
  const template = createProjectTemplate({ projectName, sunhatVersion });
  await writeProjectTemplate(destination, template);
  if (!install) {
    return 0;
  }

  const exitCode = await installer(destination);
  if (exitCode !== 0) {
    throw new SunhatCliError(
      'DEPENDENCY_INSTALL_FAILED',
      `npm install failed with exit code ${exitCode}; the generated project remains at ${destination}`
    );
  }
  return 0;
}

async function assertDelegationMarker(
  env: NodeJS.ProcessEnv,
  packageRoot: string
): Promise<void> {
  const marker = env[LOCAL_DELEGATION_ENV];
  if (marker === undefined) {
    throw new SunhatCliError(
      'CLI_RECURSION',
      'local delegation marker is missing'
    );
  }
  let realMarker: string;
  try {
    realMarker = await realpath(marker);
  } catch {
    throw new SunhatCliError(
      'INVALID_LOCAL_PACKAGE',
      'local delegation marker does not resolve to a package directory'
    );
  }
  if (realMarker !== packageRoot) {
    throw new SunhatCliError(
      'INVALID_LOCAL_PACKAGE',
      'local delegation marker does not match the resolved Sunhat package'
    );
  }
}

async function installProjectDependencies(
  projectRoot: string,
  env: NodeJS.ProcessEnv
): Promise<number> {
  return spawnChild('npm', ['install'], projectRoot, env);
}

async function spawnNodeCli(
  cliPath: string,
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<number> {
  return spawnChild(process.execPath, [cliPath, ...argv], cwd, env);
}

async function spawnChild(
  executable: string,
  argv: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<number> {
  const child = spawn(executable, argv, { cwd, env, stdio: 'inherit' });
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
  return new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal === 'SIGINT') {
        resolve(130);
      } else if (signal === 'SIGTERM') {
        resolve(143);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}
