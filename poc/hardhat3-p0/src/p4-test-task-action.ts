import type { NewTaskActionFunction } from "hardhat/types/tasks";
import { Hardhat3SolidityBackend } from "./p2-hardhat-backend.js";
import { runSunhatTestTask } from "../../../src/v2/test/index.js";

interface TestArguments {
  readonly force: boolean;
  readonly grep?: string;
  readonly grepExclude?: string;
  readonly target?: string;
  readonly testFiles: string[];
}

const testAction: NewTaskActionFunction<TestArguments> = async (
  arguments_,
  hre,
) =>
  runSunhatTestTask(
    arguments_,
    hre,
    new Hardhat3SolidityBackend(),
    ({ grep, grepExclude, noCompile, testFiles }) =>
      hre.tasks
        .getTask("test")
        .run({ grep, grepExclude, noCompile, testFiles }),
  );

export default testAction;
