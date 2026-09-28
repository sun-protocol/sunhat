import hardhatEthers from '@nomicfoundation/hardhat-ethers';
import hardhatMocha from '@nomicfoundation/hardhat-mocha';
import { defineConfig } from 'hardhat/config';
import sunhat from '../../../src/v2/index.js';

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, sunhat],
  paths: {
    tests: {
      mocha: 'test',
      solidity: 'contracts',
    },
  },
  networks: {
    hardhatMainnet: {
      type: 'edr-simulated',
      chainType: 'l1',
      sunhat: { target: 'evm' },
    },
    localEvm: {
      type: 'http',
      chainType: 'l1',
      url: 'http://127.0.0.1:8545',
      sunhat: { target: 'evm' },
    },
    tronOffline: {
      type: 'http',
      chainType: 'generic',
      url: 'http://127.0.0.1:8090',
      sunhat: { target: 'tron' },
    },
  },
  sunhat: {
    compilation: {
      defaultTarget: 'evm',
      targets: {
        evm: {
          chain: 'evm',
          sources: ['contracts'],
          compilers: [
            {
              id: 'evm-solidity',
              kind: 'solc',
              version: '0.8.25',
              settings: { optimizer: { enabled: true, runs: 200 } },
            },
          ],
        },
        tron: {
          chain: 'tron',
          sources: ['contracts'],
          compilers: [
            {
              id: 'tron-solidity',
              kind: 'tron-solc',
              version: '0.8.25',
              settings: { optimizer: { enabled: true, runs: 200 } },
            },
          ],
        },
      },
    },
    test: { target: 'evm' },
  },
});
