import type { HardhatPlugin } from 'hardhat/types/plugins';
import { isHardhat3NodeSupported } from '../../project/hardhat.js';
import './types.js';
import { assertDependency } from './dependencies.js';
import { compatibility } from '../../compatibility.js';
import { nodeSupportDescription } from '../../runtime.js';

export type * from './types.js';
if (!isHardhat3NodeSupported(process.versions.node)) {
  throw new Error(
    `Sunhat TRON requires Node.js ${nodeSupportDescription(compatibility.node.minimum.hardhat3)}`,
  );
}
for (const [name, policy] of Object.entries(compatibility.hardhat3Tron)) {
  assertDependency(name, policy.minimum, policy.entry);
}

const [{ definePlugin }, { overrideTask, task }] = await Promise.all([
  import('hardhat/plugins'),
  import('hardhat/config'),
]);

const plugin: HardhatPlugin = definePlugin({
  id: 'sunhat-hardhat3-tron',
  dependencies: () => [
    import('@nomicfoundation/hardhat-ethers'),
    import('@nomicfoundation/hardhat-mocha'),
  ],
  hookHandlers: {
    config: () => import('./config.js'),
    network: () => import('./network.js'),
    solidity: () => import('./solidity.js'),
  },
  tasks: [
    overrideTask('test')
      .setAction(async () => ({
        default: (await import('./tasks.js')).runTest,
      }))
      .build(),
    overrideTask(['test', 'mocha'])
      .setAction(async () => ({
        default: (await import('./tasks.js')).runTest,
      }))
      .build(),
    overrideTask('build')
      .setAction(async () => ({
        default: (await import('./tasks.js')).runBuild,
      }))
      .build(),
    overrideTask('node')
      .setAction(async () => ({
        default: (await import('./tasks.js')).runNode,
      }))
      .build(),
    task('tron:compile-batches')
      .setAction(async () => ({
        default: (await import('./tasks.js')).runBatches,
      }))
      .build(),
  ],
});
export default plugin;
