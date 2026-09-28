import type { HardhatPluginLike } from './contracts.js';

/**
 * Hardhat 3 plugin definition.
 *
 * The 2.x ESM package entry wraps this structural definition with Hardhat's
 * public definePlugin helper. P1 keeps that registration adapter in the
 * isolated Hardhat 3 fixture so the current 1.x package remains loadable.
 */
const sunhatPlugin: HardhatPluginLike = {
  id: 'sunhat',
  hookHandlers: {
    config: () => import('./config-hook.js'),
  },
};

export default sunhatPlugin;
export * from './contracts.js';
