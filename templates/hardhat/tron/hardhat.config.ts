import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-chai-matchers';
import '@openzeppelin/hardhat-tron';
import type { HardhatUserConfig } from 'hardhat/config';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      viaIR: true,
      metadata: { bytecodeHash: 'ipfs', useLiteralContent: true },
    },
  },
  tre: {
    autoStart: true,
    image: 'tronbox/tre:dev',
    compiler: { target: 'tron' },
  },
  defaultNetwork: 'tre',
  networks: {
    tre: {
      url: process.env.TRE_URL ?? 'http://127.0.0.1:9090/jsonrpc',
      tron: true,
      // Public TRE genesis development key.
      // Never use it on a live network.
      accounts: [
        process.env.TRE_PRIVATE_KEY ??
          '0x0000000000000000000000000000000000000000000000000000000000000001',
      ],
    },
  },
};

export default config;
