import type { NewTaskActionFunction } from 'hardhat/types/tasks';
import { runSunhatTestTask } from '../../test/index.js';
import { Hardhat3SolidityBackend } from '../solidity-backend.js';

interface TestArguments {
  readonly force: boolean;
  readonly grep?: string;
  readonly grepExclude?: string;
  readonly target?: string;
  readonly testFiles: string[];
}

const testAction: NewTaskActionFunction<TestArguments> = async (
  arguments_,
  hre
) =>
  runSunhatTestTask(
    arguments_,
    hre,
    new Hardhat3SolidityBackend(),
    ({ grep, grepExclude, noCompile, testFiles }) =>
      hre.tasks
        .getTask('test')
        .run({ grep, grepExclude, noCompile, testFiles })
  );

export default testAction;
