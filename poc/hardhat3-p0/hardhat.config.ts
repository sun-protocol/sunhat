import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import { defineConfig } from "hardhat/config";
import sunhatProbe from "./src/plugin.js";

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, sunhatProbe],
  solidity: {
    profiles: {
      default: {
        version: "0.8.25",
      },
      production: {
        version: "0.8.25",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
  },
});
