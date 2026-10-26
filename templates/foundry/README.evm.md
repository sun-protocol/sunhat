# Foundry EVM Project with Sunhat

This project uses Sunhat to select and run a project-local Foundry toolchain for an EVM target. The framework and target are fixed in `sunhat.toml`.

## Quick start

```bash
npm install
npx sunhat toolchain install
npx sunhat toolchain check
npm run build
npm test
```

`toolchain install` downloads the Foundry release pinned by Sunhat and stores it under `.sunhat/toolchains/`. Subsequent commands verify the executable digest before running it.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile contracts with `sunhat build`. |
| `npm test` | Run the Foundry test suite with `sunhat test`. |
| `npx sunhat build --sizes` | Compile contracts and report contract sizes. |
| `npx sunhat test -vvv` | Run tests with verbose traces. |
| `npx sunhat test --match-contract CounterTest` | Run one test contract. |
| `npx sunhat snapshot` | Record gas snapshots. |
| `npx sunhat coverage` | Generate a coverage report. |
| `npx sunhat script <path>` | Run a Foundry script. |
| `npx sunhat create <contract>` | Deploy a contract with Forge. |
| `npx sunhat cast <command>` | Run a Cast command through the selected toolchain. |
| `npx sunhat anvil` | Start the project-pinned Anvil node. |
| `npx sunhat chisel` | Start the project-pinned Solidity REPL. |
| `npx sunhat toolchain info` | Print the pinned toolchain metadata. |
| `npx sunhat toolchain check` | Verify the installed binary digests. |

Arguments after the Sunhat command are passed to Foundry unchanged.
