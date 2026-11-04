import hardhatMatchers from '@nomicfoundation/hardhat-ethers-chai-matchers';
import hardhatMocha from '@nomicfoundation/hardhat-mocha';
import { defineConfig } from 'hardhat/config';
import sunhatTron from 'sunhat/hardhat3-tron';
import { HDNodeWallet } from 'ethers';

const tron = {
  type: 'http',
  tron: true,
  url: process.env.TRE_URL + '/jsonrpc',
  accounts: [
    process.env.TRE_PRIVATE_KEY,
    HDNodeWallet.fromPhrase(
      'test test test test test test test test test test test junk',
      undefined,
      "m/44'/60'/0'/0/1",
    ).privateKey,
  ],
};
export default defineConfig({
  plugins: [sunhatTron, hardhatMocha, hardhatMatchers],
  paths: { sources: ['contracts', 'src'] },
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      viaIR: true,
    },
  },
  tre: {
    autoStart: process.env.SUNHAT_TRE_AUTO === 'true',
    autoStartOnCompile: process.env.SUNHAT_TRE_AUTO_COMPILE === 'true',
    autoStartOnTest: process.env.SUNHAT_TRE_AUTO_TEST !== 'false',
    keepRunning: process.env.SUNHAT_TRE_KEEP === 'true',
    containerName: process.env.SUNHAT_TRE_NAME,
    jarPath: process.env.SUNHAT_OWNED_JAR,
    matchers: true,
    compiler: { path: process.env.SUNHAT_TRON_SOLC },
  },
  networks: {
    default: tron,
    tre: tron,
    alias: { ...tron, url: tron.url.replace('127.0.0.1', 'localhost') },
    evm: { type: 'edr-simulated' },
    readonly: { ...tron, accounts: 'remote' },
    ...(process.env.TRE_OTHER_URL
      ? {
          other: {
            ...tron,
            url: process.env.TRE_OTHER_URL + '/jsonrpc',
            accounts: [
              HDNodeWallet.fromPhrase(
                'test test test test test test test test test test test junk',
                undefined,
                "m/44'/60'/0'/0/1",
              ).privateKey,
            ],
          },
        }
      : {}),
  },
});
