import hardhatMocha from '@nomicfoundation/hardhat-mocha';
import { defineConfig } from 'hardhat/config';

if (!process.env.SUNHAT_TRON_SOLC) {
  throw new Error('This probe requires a checksum-verified tron-solc path');
}

export default defineConfig({
  plugins: [hardhatMocha],
  solidity: {
    version: '0.8.26',
    path: process.env.SUNHAT_TRON_SOLC,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      viaIR: true,
      metadata: { bytecodeHash: 'ipfs', useLiteralContent: true },
    },
  },
});
