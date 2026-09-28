import "./sunhat-v2-type-extensions.js";

import type { HardhatPlugin } from "hardhat/types/plugins";
import { emptyTask, task } from "hardhat/config";
import { definePlugin } from "hardhat/plugins";
import { ArgumentType } from "hardhat/types/arguments";
import sunhatPluginDefinition from "../../../src/v2/plugin/index.js";

const tasks = [
  emptyTask(["sunhat"], "Sunhat project tasks").build(),
  task(["sunhat", "compile"], "Compile configured Sunhat targets")
    .addOption({
      name: "target",
      description: "Compile one named Sunhat target",
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addFlag({
      name: "all",
      description: "Compile every configured Sunhat target",
    })
    .addFlag({
      name: "force",
      description: "Ignore mutable and immutable build caches",
    })
    .setAction(() => import("./p2-compile-task-action.js"))
    .build(),
];

export default definePlugin({
  ...(sunhatPluginDefinition as unknown as HardhatPlugin),
  tasks,
});
