import type {
  TaskOverrideActionFunction,
  NewTaskActionFunction,
} from 'hardhat/types/tasks';
import type { HardhatRuntimeEnvironment } from 'hardhat/types/hre';
import { acquireTre, taskContext } from './resources.js';
import { withCleanup } from './cleanup.js';
import type { TreTask } from './resources.js';
import { describeEndpoint } from '../../../vendor/hardhat-tron/runtime/transport.js';

async function acquireSelected(
  hre: HardhatRuntimeEnvironment,
  requireReady = false,
): Promise<() => Promise<void>> {
  const selected = hre.config.networks[hre.globalOptions.network ?? 'default'];
  const config = hre.config.tre;
  if (
    selected?.type !== 'http' ||
    selected.tron !== true ||
    config === undefined
  ) {
    return async () => {};
  }
  const reason = taskContext.getStore();
  const policy =
    reason === 'test'
      ? config.autoStartOnTest
      : reason === 'compile'
        ? config.autoStartOnCompile
        : config.autoStartOnNode;
  if (!requireReady && (!config.autoStart || !policy)) {
    return async () => {};
  }
  return acquireTre(config, await selected.url.getUrl(), selected.httpHeaders);
}
function wrap(reason: TreTask): TaskOverrideActionFunction {
  return async (args, hre, runSuper) =>
    taskContext.run(reason, async () => {
      const release = await acquireSelected(hre);
      return withCleanup(() => runSuper(args), release);
    });
}
export const runTest = wrap('test');
export const runBuild = wrap('compile');
export const runNode: TaskOverrideActionFunction = async (
  args,
  hre,
  runSuper,
) => {
  const selected = hre.config.networks[hre.globalOptions.network ?? 'default'];
  if (selected?.type !== 'http' || selected.tron !== true) {
    return runSuper(args);
  }
  return taskContext.run('node', async () => {
    const release = await acquireSelected(hre, true);
    console.log(
      `TRON node ready at ${describeEndpoint(await selected.url.getUrl())}; the TRE container remains running after exit`,
    );
    await new Promise<void>((done) => {
      const alive = setInterval(() => {}, 1000);
      const finish = () => {
        clearInterval(alive);
        process.off('SIGINT', finish);
        process.off('SIGTERM', finish);
        done();
      };
      process.once('SIGINT', finish);
      process.once('SIGTERM', finish);
    });
    await release();
  });
};
export const runBatches: NewTaskActionFunction = async (_, hre) => {
  if (!hre.config.tre?.compiler.batches.length) {
    throw new Error('tron:compile-batches requires tre.compiler.batches');
  }
  const roots = await hre.solidity.getRootFilePaths();
  const result = await hre.solidity.build(roots);
  if (
    !(result instanceof Map) ||
    [...result.values()].some((entry) => entry.type === 'BUILD_FAILURE')
  ) {
    throw new Error('TRON batch compilation failed');
  }
};
