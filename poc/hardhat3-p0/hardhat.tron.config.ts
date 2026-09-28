import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "hardhat/config";

const compilerPath = process.env.TRON_SOLC_PATH;
const expectedSha256 = process.env.TRON_SOLC_SHA256;

if (compilerPath === undefined || !path.isAbsolute(compilerPath)) {
  throw new Error("TRON_SOLC_PATH must be an absolute path");
}
if (expectedSha256 === undefined || !/^[0-9a-f]{64}$/i.test(expectedSha256)) {
  throw new Error("TRON_SOLC_SHA256 must be a SHA-256 hex digest");
}

const compilerSha256 = createHash("sha256")
  .update(readFileSync(compilerPath))
  .digest("hex");
if (compilerSha256 !== expectedSha256.toLowerCase()) {
  throw new Error("tron-solc executable SHA-256 mismatch");
}

export default defineConfig({
  paths: {
    artifacts: "artifacts-tron",
    cache: "cache-tron",
    sources: "contracts",
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.25",
        path: compilerPath,
      },
      "tron-production": {
        version: "0.8.25",
        path: compilerPath,
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
});
