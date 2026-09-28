import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import { defineConfig } from "hardhat/config";
import sunhatProbe from "./src/plugin.js";
import sunhatV2 from "./src/sunhat-v2-plugin.js";

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, sunhatProbe, sunhatV2],
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
      sunhat: { target: "evm" },
    },
  },
  sunhat: {
    compilation: {
      defaultTarget: "evm",
      targets: {
        evm: {
          chain: "evm",
          sources: ["contracts"],
          compilers: [
            {
              id: "evm-solidity",
              kind: "solc",
              version: "0.8.25",
              settings: { optimizer: { enabled: true, runs: 200 } },
            },
          ],
        },
      },
    },
    test: { target: "evm" },
  },
});
