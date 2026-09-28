import type { NewTaskActionFunction } from 'hardhat/types/tasks';
import { runCompileTask } from '../../../src/v2/build/task.js';
import { Hardhat3SolidityBackend } from './p2-hardhat-backend.js';

interface CompileArguments {
  readonly all: boolean;
  readonly force: boolean;
  readonly target?: string;
}

const compileAction: NewTaskActionFunction<CompileArguments> = async (
  arguments_,
  hre
) => {
  const results = await runCompileTask(
    arguments_,
    hre,
    new Hardhat3SolidityBackend()
  );
  for (const result of results) {
    process.stdout.write(
      `${JSON.stringify({
        buildId: result.buildId,
        cacheHit: result.cacheHit,
        snapshotDirectory: result.snapshotDirectory,
        target: result.targetName,
      })}\n`
    );
  }
};

export default compileAction;
