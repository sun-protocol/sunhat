import type { HardhatPlugin } from 'hardhat/types/plugins';
import { isHardhat3NodeSupported } from '../../project/hardhat.js';
import './types.js';
import { assertDependency } from './dependencies.js';

export type * from './types.js';
if (!isHardhat3NodeSupported(process.versions.node)) {
  throw new Error('Sunhat TRON requires Node.js 22.13+, 24.x or 26.x');
}
for (const [name, version] of [
  ['hardhat', '3.21.1'],
  ['@nomicfoundation/hardhat-ethers', '4.2.1'],
  ['@nomicfoundation/hardhat-mocha', '4.0.1'],
  ['ethers', '6.17.0'],
  ['@openzeppelin/tron-runtime', '0.1.0'],
  ['tronweb', '6.5.1'],
  ['solc', '0.8.26'],
]) {
  if (name !== undefined && version !== undefined) {
    assertDependency(name, version);
  }
}

assertDependency(
  '@nomicfoundation/hardhat-utils',
  '5.1.1',
  '@nomicfoundation/hardhat-utils/package.json',
);

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
