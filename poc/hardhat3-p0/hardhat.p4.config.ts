import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import { defineConfig } from "hardhat/config";
import sunhatV2 from "./src/sunhat-v2-plugin.js";

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, sunhatV2],
  paths: {
    tests: {
      mocha: "p4-tests",
      solidity: "p2-contracts",
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
          sources: ["p2-contracts"],
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
