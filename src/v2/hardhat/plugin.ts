import './type-extensions.js';

import type { HardhatPlugin } from 'hardhat/types/plugins';
import { emptyTask, task } from 'hardhat/config';
import { definePlugin } from 'hardhat/plugins';
import { ArgumentType } from 'hardhat/types/arguments';
import sunhatPluginDefinition from '../plugin/index.js';

const tasks = [
  emptyTask(['sunhat'], 'Sunhat project tasks').build(),
  emptyTask(['sunhat', 'verification'], 'Sunhat verification tasks').build(),
  task(['sunhat', 'clean'], 'Remove reproducible Sunhat artifacts and caches')
    .setAction(() => import('./actions/clean.js'))
    .build(),
  task(['sunhat', 'compile'], 'Compile configured Sunhat targets')
    .addOption({
      name: 'target',
      description: 'Compile one named Sunhat target',
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addFlag({
      name: 'all',
      description: 'Compile every configured Sunhat target',
    })
    .addFlag({
      name: 'force',
      description: 'Ignore mutable and immutable build caches',
    })
    .setAction(() => import('./actions/compile.js'))
    .build(),
  task(['sunhat', 'test'], 'Build one Sunhat target and run Hardhat tests')
    .addVariadicArgument({
      name: 'testFiles',
      description: 'Optional test files to run',
      defaultValue: [],
    })
    .addOption({
      name: 'target',
      description: 'Test one named Sunhat target',
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addOption({
      name: 'grep',
      description: 'Only run tests matching this expression',
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addOption({
      name: 'grepExclude',
      description: 'Exclude tests matching this expression',
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addFlag({
      name: 'force',
      description: 'Ignore mutable and immutable build caches',
    })
    .setAction(() => import('./actions/test.js'))
    .build(),
  task(
    ['sunhat', 'deploy'],
    'Run deployment scripts and archive verification inputs'
  )
    .addFlag({
      name: 'force',
      description: 'Ignore mutable and immutable build caches',
    })
    .setAction(() => import('./actions/deploy.js'))
    .build(),
  task(['sunhat', 'verification', 'sync'], 'Recover one verification archive')
    .addOption({
      name: 'tx',
      description: 'Deployment transaction id',
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .setAction(() => import('./actions/verification-sync.js'))
    .build(),
];

export default definePlugin({
  ...(sunhatPluginDefinition as unknown as HardhatPlugin),
  tasks,
});
