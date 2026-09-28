import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  assertRuntimeCompatibility,
  delegateToProjectLocalCli,
  locateProject,
  LOCAL_DELEGATION_ENV,
  mapHardhatArguments,
  readConfigArgument,
  resolveProjectRuntime,
  runSunhatCli,
  SunhatCliError,
} from '../src/v2/cli/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe('Sunhat 2.x project discovery', () => {
  it('finds a project config from a nested directory', async () => {
    const root = await temporaryDirectory();
    const nested = path.join(root, 'packages', 'contracts', 'scripts');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, 'hardhat.config.ts'), 'export default {};\n');

    const project = await locateProject(nested);
    assert.equal(project.projectRoot, root);
    assert.equal(project.configPath, path.join(root, 'hardhat.config.ts'));
  });

  it('resolves an explicit config relative to the current directory', async () => {
    const root = await temporaryDirectory();
    const configDirectory = path.join(root, 'config');
    await mkdir(configDirectory, { recursive: true });
    await writeFile(path.join(configDirectory, 'sunhat.ts'), 'export default {};\n');

    const project = await locateProject(root, 'config/sunhat.ts');
    assert.equal(project.projectRoot, configDirectory);
  });

  it('rejects ambiguous default config files', async () => {
    const root = await temporaryDirectory();
    await Promise.all([
      writeFile(path.join(root, 'hardhat.config.ts'), ''),
      writeFile(path.join(root, 'hardhat.config.js'), ''),
    ]);

    await assert.rejects(() => locateProject(root), cliError('AMBIGUOUS_CONFIG'));
  });

  it('rejects directories outside a Hardhat project', async () => {
    const root = await temporaryDirectory();
    await assert.rejects(() => locateProject(root), cliError('PROJECT_NOT_FOUND'));
  });

  it('parses --config without removing forwarded arguments', () => {
    const argv = ['compile', '--network', 'nile', '--config=config/hardhat.ts'];
    assert.equal(readConfigArgument(argv), 'config/hardhat.ts');
    assert.deepEqual(argv, [
      'compile',
      '--network',
      'nile',
      '--config=config/hardhat.ts',
    ]);
    assert.equal(readConfigArgument(['test', '--', '--config', 'fixture.ts']), undefined);
  });

  it('rejects repeated or missing --config values', () => {
    assert.throws(() => readConfigArgument(['--config']), cliError('CONFIG_ARGUMENT_INVALID'));
    assert.throws(
      () => readConfigArgument(['--config=a.ts', '--config', 'b.ts']),
      cliError('CONFIG_ARGUMENT_INVALID')
    );
  });
});

describe('Sunhat 2.x local runtime resolution', () => {
  it('resolves project-local Sunhat and Hardhat from a workspace-style node_modules', async () => {
    const root = await temporaryDirectory();
    await createRuntimeFixture(root, '2.0.0-rc.1', '3.15.0');

    const runtime = await resolveProjectRuntime(root);
    assert.equal(runtime.sunhatVersion, '2.0.0-rc.1');
    assert.equal(runtime.hardhatVersion, '3.15.0');
    assert.equal(path.basename(runtime.cliPath), 'cli.js');
  });

  it('fails before task execution when local dependencies are missing', async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');

    await assert.rejects(
      () => resolveProjectRuntime(root),
      cliError('LOCAL_DEPENDENCY_MISSING')
    );
  });

  it('rejects Hardhat 2, Sunhat 1, and old Node versions', () => {
    assert.throws(
      () =>
        assertRuntimeCompatibility({
          hardhatVersion: '2.29.1',
          nodeVersion: '24.15.0',
          sunhatVersion: '2.0.0',
        }),
      cliError('INCOMPATIBLE_HARDHAT')
    );
    assert.throws(
      () =>
        assertRuntimeCompatibility({
          hardhatVersion: '3.15.0',
          nodeVersion: '24.15.0',
          sunhatVersion: '1.5.0',
        }),
      cliError('INCOMPATIBLE_SUNHAT')
    );
    assert.throws(
      () =>
        assertRuntimeCompatibility({
          hardhatVersion: '3.15.0',
          nodeVersion: '22.12.0',
          sunhatVersion: '2.0.0',
        }),
      cliError('INCOMPATIBLE_NODE')
    );
    assert.throws(
      () =>
        assertRuntimeCompatibility({
          hardhatVersion: '3.15.0-corrupt!',
          nodeVersion: '24.15.0',
          sunhatVersion: '2.0.0',
        }),
      cliError('INVALID_LOCAL_PACKAGE')
    );
  });
});

describe('Sunhat 2.x global-to-local delegation', () => {
  it('forwards arguments, cwd, environment, and the child exit code', async () => {
    const root = await temporaryDirectory();
    const nested = path.join(root, 'scripts');
    const outputPath = path.join(root, 'delegated.json');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, 'hardhat.config.ts'), 'export default {};\n');
    await createRuntimeFixture(root, '2.0.0', '3.15.0');

    const exitCode = await delegateToProjectLocalCli({
      argv: ['compile', '--network', 'nile'],
      cwd: nested,
      env: {
        ...process.env,
        SUNHAT_TEST_EXIT_CODE: '7',
        SUNHAT_TEST_OUTPUT: outputPath,
      },
    });
    const delegated = JSON.parse(await readFile(outputPath, 'utf8'));

    assert.equal(exitCode, 7);
    assert.deepEqual(delegated.argv, ['compile', '--network', 'nile']);
    assert.equal(delegated.cwd, await realpath(nested));
    assert.equal(
      delegated.delegationRoot,
      await realpath(path.join(root, 'node_modules', '@sun-protocol', 'sunhat'))
    );
  });

  it('stops recursive global-to-local launches before project lookup', async () => {
    await assert.rejects(
      () =>
        delegateToProjectLocalCli({
          argv: ['compile'],
          cwd: '/does/not/matter',
          env: { [LOCAL_DELEGATION_ENV]: '/already/delegated' },
        }),
      cliError('CLI_RECURSION')
    );
  });
});

describe('Sunhat 2.x command entry', () => {
  it('reports help and version without requiring a Hardhat project', async () => {
    const root = await temporaryDirectory();
    const output: string[] = [];
    const common = {
      currentVersion: '2.0.0-alpha.1',
      cwd: root,
      env: {},
      writeOutput: (value: string) => output.push(value),
    } as const;

    assert.equal(await runSunhatCli({ ...common, argv: ['--version'] }), 0);
    assert.equal(output.pop(), '2.0.0-alpha.1\n');

    assert.equal(await runSunhatCli({ ...common, argv: ['--help'] }), 0);
    assert.match(output.pop() ?? '', /^Usage: sunhat <command>/u);
  });

  it('initializes a pinned project and installs dependencies by default', async () => {
    const root = await temporaryDirectory();
    let installedAt: string | undefined;

    const exitCode = await runSunhatCli({
      argv: ['init', 'contracts-app'],
      currentVersion: '2.0.0-rc.1',
      cwd: root,
      env: {},
      installDependencies: async (projectRoot) => {
        installedAt = projectRoot;
        return 0;
      },
    });

    const projectRoot = path.join(root, 'contracts-app');
    assert.equal(exitCode, 0);
    assert.equal(installedAt, projectRoot);
    assert.equal(
      JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
        .devDependencies['@sun-protocol/sunhat'],
      '2.0.0-rc.1'
    );
  });

  it('keeps a generated project recoverable when dependency installation fails', async () => {
    const root = await temporaryDirectory();
    const projectRoot = path.join(root, 'contracts-app');

    await assert.rejects(
      () =>
        runSunhatCli({
          argv: ['init', 'contracts-app'],
          currentVersion: '2.0.0',
          cwd: root,
          env: {},
          installDependencies: async () => 17,
        }),
      cliError('DEPENDENCY_INSTALL_FAILED')
    );
    assert.equal(
      JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
        .name,
      'contracts-app'
    );
  });

  it('maps stable Sunhat commands to public Hardhat 3 tasks', () => {
    assert.deepEqual(mapHardhatArguments(['compile']), ['sunhat', 'compile']);
    assert.deepEqual(mapHardhatArguments(['build', '--network', 'nile']), [
      'sunhat',
      'compile',
      '--network',
      'nile',
    ]);
    assert.deepEqual(mapHardhatArguments(['test', 'test/Counter.ts']), [
      'sunhat',
      'test',
      'test/Counter.ts',
    ]);
    assert.deepEqual(mapHardhatArguments(['clean']), ['sunhat', 'clean']);
    assert.deepEqual(mapHardhatArguments(['deploy', '--network', 'nile']), [
      'sunhat',
      'deploy',
      '--network',
      'nile',
    ]);
    assert.deepEqual(
      mapHardhatArguments(['verification', 'sync', '--tx', '0x1234']),
      ['sunhat', 'verification', 'sync', '--tx', '0x1234']
    );
  });

  it('runs delegated commands through the resolved project-local Hardhat CLI', async () => {
    const root = await temporaryDirectory();
    const nested = path.join(root, 'scripts');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(root, 'hardhat.config.ts'), 'export default {};\n');
    await createRuntimeFixture(root, '2.0.0', '3.15.0');
    const runtime = await resolveProjectRuntime(root);
    let invocation:
      | { cliPath: string; argv: readonly string[]; cwd: string }
      | undefined;

    const exitCode = await runSunhatCli({
      argv: ['test', 'test/Counter.ts'],
      currentVersion: '2.0.0',
      cwd: nested,
      env: { [LOCAL_DELEGATION_ENV]: runtime.packageRoot },
      runHardhat: async (cliPath, argv, cwd) => {
        invocation = { cliPath, argv, cwd };
        return 9;
      },
    });

    assert.equal(exitCode, 9);
    assert.deepEqual(invocation, {
      cliPath: runtime.hardhatCliPath,
      argv: ['sunhat', 'test', 'test/Counter.ts'],
      cwd: nested,
    });
  });

  it('rejects a forged local delegation marker', async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, 'hardhat.config.ts'), 'export default {};\n');
    await createRuntimeFixture(root, '2.0.0', '3.15.0');

    await assert.rejects(
      () =>
        runSunhatCli({
          argv: ['compile'],
          currentVersion: '2.0.0',
          cwd: root,
          env: { [LOCAL_DELEGATION_ENV]: root },
          runHardhat: async () => 0,
        }),
      cliError('INVALID_LOCAL_PACKAGE')
    );
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sunhat-p1-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function createRuntimeFixture(
  root: string,
  sunhatVersion: string,
  hardhatVersion: string
): Promise<void> {
  const sunhatRoot = path.join(root, 'node_modules', '@sun-protocol', 'sunhat');
  const hardhatRoot = path.join(root, 'node_modules', 'hardhat');
  await Promise.all([
    mkdir(path.join(sunhatRoot, 'dist'), { recursive: true }),
    mkdir(path.join(hardhatRoot, 'dist'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(root, 'package.json'), '{"type":"module"}\n'),
    writeFile(
      path.join(sunhatRoot, 'package.json'),
      `${JSON.stringify({
        name: '@sun-protocol/sunhat',
        version: sunhatVersion,
        bin: { sunhat: './dist/cli.js' },
      })}\n`
    ),
    writeFile(
      path.join(sunhatRoot, 'dist', 'cli.js'),
      `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(process.env.SUNHAT_TEST_OUTPUT, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  delegationRoot: process.env.${LOCAL_DELEGATION_ENV},
}));
process.exit(Number(process.env.SUNHAT_TEST_EXIT_CODE || '0'));
`
    ),
    writeFile(
      path.join(hardhatRoot, 'package.json'),
      `${JSON.stringify({
        name: 'hardhat',
        version: hardhatVersion,
        bin: { hardhat: './dist/cli.js' },
      })}\n`
    ),
    writeFile(path.join(hardhatRoot, 'dist', 'cli.js'), 'process.exit(0);\n'),
  ]);
}

function cliError(code: SunhatCliError['code']) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof SunhatCliError);
    assert.equal(error.code, code);
    return true;
  };
}
