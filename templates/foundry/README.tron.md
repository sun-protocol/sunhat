# Foundry TRON Project with Sunhat

This project uses Sunhat to select and run a project-local Foundry-TRON toolchain. The framework and TRON target are fixed in `sunhat.toml`.

## Quick start

```bash
npm install
npx sunhat toolchain install
npx sunhat toolchain check
npm run build
npm test
```

`toolchain install` downloads the Foundry-TRON release pinned by Sunhat and stores it under `.sunhat/toolchains/`. Subsequent commands verify the executable digest before running it.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile contracts with `sunhat build`. |
| `npm test` | Run tests on the TRON execution path with `sunhat test`. |
| `npx sunhat build --sizes` | Compile contracts and report contract sizes. |
| `npx sunhat test -vvv` | Run tests with verbose traces. |
| `npx sunhat test --match-contract CounterTest` | Run one test contract. |
| `npx sunhat test --gas-report` | Report energy and bandwidth usage. |
| `npx sunhat snapshot` | Record energy snapshots. |
| `npx sunhat coverage` | Generate a coverage report. |
| `npx sunhat script <path>` | Run a Foundry script. |
| `npx sunhat create <contract>` | Deploy a contract through the TRON transaction path. |
| `npx sunhat cast <command>` | Run a Cast command through Foundry-TRON. |
| `npx sunhat toolchain info` | Print the pinned toolchain metadata. |
| `npx sunhat toolchain check` | Verify the installed binary digests. |

Arguments after the Sunhat command are passed to Foundry-TRON unchanged.

## Toolchain requirement

`foundry.toml` contains `network = "tron"`. This setting requires the Foundry-TRON fork selected by Sunhat.

Do not run a globally installed `forge` directly. Standard Foundry does not recognize the `tron` network and fails while parsing `foundry.toml`. Use these commands instead:

```bash
npx sunhat build
npx sunhat test
```

TRON builds use the native `tron-solc` resolved by Foundry-TRON. `anvil` and `chisel` are unavailable for this target.
