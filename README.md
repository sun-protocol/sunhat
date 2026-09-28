# Sunhat 2.x

Sunhat 2.x is an ESM-first Hardhat 3 plugin for configuration-driven Solidity, tron-solc, and Vyper builds. Every deployment is bound to an immutable build snapshot and produces a self-contained verification archive after the transaction reaches the configured confirmation threshold.

The current `2.0.0-alpha.1` package has passed the local EVM/EDR `compile → test → deploy → archive` flow. TRON compilation and archive primitives are implemented, but production task actions intentionally reject TRON broadcast and sync until Solidity/Vyper execution, receipts, Energy, and Bandwidth pass the real TVM matrix. Use Sunhat 1.x for existing TRON deployments until that gate closes.

## Requirements

- Node.js `>=22.13.0`
- Hardhat `>=3.15.0 <4`
- An ESM project (`"type": "module"`)
- `@nomicfoundation/hardhat-ethers >=4.0.3 <5` for EVM deployment and sync

## Start a project

```bash
npm install -g @sun-protocol/sunhat@2.0.0-alpha.1
sunhat init contracts-app
cd contracts-app
sunhat compile
sunhat test
```

The global command only locates the project. All non-`init` commands delegate once to the project-local Sunhat and Hardhat versions, including calls made from a project subdirectory or with `--config`.

## Configure Hardhat 3

```ts
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import sunhat from "@sun-protocol/sunhat";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatEthers, hardhatMocha, sunhat],
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
    verification: {
      outputDir: "verification",
      sourceMode: "multi-file",
      autoExport: true,
    },
  },
});
```

Sunhat configuration is the only compilation source for managed targets. Defining a native Hardhat `solidity` section at the same time is rejected instead of silently merging two compiler configurations.

## Commands

| Command | Behavior |
| --- | --- |
| `sunhat init [directory]` | Creates a pinned Hardhat 3 ESM project without Forge. |
| `sunhat compile [--target name] [--network name]` | Builds one configured target and records an immutable snapshot. |
| `sunhat compile --all` | Builds every target without merging their artifacts. |
| `sunhat test [files...]` | Builds once, then runs Hardhat 3 Mocha and native Solidity tests with `noCompile`. |
| `sunhat deploy --network name` | Runs ordered ESM deployment scripts and archives a successful EVM deployment. |
| `sunhat verification sync --network name --tx id` | Recovers a saved EVM deployment attempt without rebroadcasting. |

Deployment scripts export one async function and receive an explicit context:

```ts
import type { SunhatDeploymentContext } from "@sun-protocol/sunhat/deploy";

export default async function deployCounter({
  deploy,
}: SunhatDeploymentContext): Promise<void> {
  await deploy({
    constructorArguments: ["42"],
    fullyQualifiedName: "contracts/Counter.sol:Counter",
  });
}
```

The public deployment barrel exposes this context together with the chain-independent archive and adapter types.

## Build integrity

- solc, tron-solc, and Vyper targets have isolated caches and artifacts.
- Custom compiler executables require an absolute path and expected SHA-256.
- Build IDs include compiler identity, normalized settings, source-unit names, and dependency contents.
- Failed builds cannot reuse stale successful output.
- Deployment attempts are persisted before broadcast; unknown outcomes are recovered with `verification sync`, never by automatic rebroadcast.
- Verification archives preserve source inputs, artifacts, build info, constructor data, receipt, queried runtime code, and per-file hashes.

## Development

```bash
npm install
npm run typecheck
npm test
npm run test:p4:integration
npm run test:p4:deploy
npm run pack:check
```

`npm run test:compiler-integration` additionally requires absolute, hash-pinned `TRON_SOLC_PATH` and `VYPER_JSON_PATH` toolchains. Real TRON broadcast is not part of the alpha test commands.

The repository skill is under `skills/sunhat/`; Codex discovers the same directory through `.agents/skills/sunhat`.

## License

[MIT](LICENSE)
