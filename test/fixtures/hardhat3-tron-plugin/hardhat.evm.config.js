import config from './hardhat.config.js';
export default {
  ...config,
  tre: { ...config.tre, compiler: { target: 'evm' } },
};
