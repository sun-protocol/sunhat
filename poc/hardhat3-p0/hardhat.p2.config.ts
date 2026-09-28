import { defineConfig } from "hardhat/config";
import sunhatV2 from "./src/sunhat-v2-plugin.js";

export default defineConfig({
  plugins: [sunhatV2],
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
  },
});
