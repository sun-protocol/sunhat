import hardhatEthers from '@nomicfoundation/hardhat-ethers';
import hardhatMocha from '@nomicfoundation/hardhat-mocha';
import { defineConfig } from 'hardhat/config';

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha],
  solidity: '0.8.26',
});
