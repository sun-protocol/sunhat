import config from './hardhat.config.js';

export default {
  ...config,
  paths: { artifacts: 'artifacts-batches', cache: 'cache-batches' },
  tre: {
    ...config.tre,
    compiler: {
      ...config.tre.compiler,
      include: ['contracts/**/*.sol', 'src/**/*.sol'],
      exclude: ['**/Excluded.sol'],
      batchesPath: './batches.cjs',
    },
  },
};
