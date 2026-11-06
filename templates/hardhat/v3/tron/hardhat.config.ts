import { defineConfig } from 'hardhat/config';
import type { HttpNetworkUserConfig } from 'hardhat/types/config';
import sunhatTron from 'sunhat/hardhat3-tron';

const endpoint = new URL(process.env.TRE_URL ?? 'http://127.0.0.1:9090');
endpoint.pathname =
  endpoint.pathname.replace(/\/jsonrpc\/?$/i, '').replace(/\/$/, '') +
  '/jsonrpc';
endpoint.hash = '';
const local = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
const developmentKey =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const key = process.env.TRE_PRIVATE_KEY ?? (local ? developmentKey : undefined);
const tron = {
  type: 'http',
  tron: true,
  url: endpoint.href,
  accounts: key === undefined ? 'remote' : [key],
} satisfies HttpNetworkUserConfig;

export default defineConfig({
  plugins: [sunhatTron],
  solidity: '0.8.26',
  tre: {
    autoStart: process.env.TRE_AUTO_START === 'true',
    keepRunning: process.env.TRE_KEEP_RUNNING === 'true',
    jarPath: process.env.TRE_JAR_PATH,
    compiler: { target: 'tron', path: process.env.TRON_SOLC_PATH },
  },
  networks: {
    default: tron,
    tre: tron,
  },
});
