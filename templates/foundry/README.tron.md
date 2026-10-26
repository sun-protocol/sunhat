# Foundry TRON Project with Sunhat

This project uses Sunhat to select and run a project-local Foundry-TRON toolchain. The framework and TRON target are fixed in `sunhat.toml`.

## Global command prerequisites

The `sunhat ...` examples require Sunhat 2.0.0 installed globally and npm's global executable directory on `PATH`. Verify the installation with `sunhat --version`. To install from a Sunhat source checkout, run `npm install`, `npm run build`, and `npm install --global .` in that checkout, not in this generated project.

Run project commands from this directory or a subdirectory. Install the project-pinned Foundry-TRON toolchain with `sunhat toolchain install` before building, testing, or using Cast. Global Sunhat still uses the binaries in this project's `.sunhat/` directory. Anvil and Chisel are unavailable for TRON.

For a local-only installation, replace `sunhat` with `npx --no-install sunhat` in the examples after running `npm install`. `npm run build` and `npm test` use the project's local Sunhat automatically. A global invocation does not automatically switch to the local Sunhat copy.

## Quick start

```bash
npm install
sunhat toolchain install
sunhat toolchain check
npm run build
npm test
```

`toolchain install` downloads the Foundry-TRON release pinned by Sunhat and stores it under `.sunhat/toolchains/`. Subsequent commands verify the executable digest before running it.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile contracts with `sunhat build`. |
| `npm test` | Run tests on the TRON execution path with `sunhat test`. |
| `sunhat build --sizes` | Compile contracts and report contract sizes. |
| `sunhat test -vvv` | Run tests with verbose traces. |
| `sunhat test --match-contract CounterTest` | Run one test contract. |
| `sunhat test --gas-report` | Report energy and bandwidth usage. |
| `sunhat snapshot` | Record energy snapshots. |
| `sunhat coverage` | Generate a coverage report. |
| `sunhat script <path>` | Run a Foundry script. |
| `sunhat create <contract>` | Deploy a contract through the TRON transaction path. |
| `sunhat cast <command>` | Run a Cast command through Foundry-TRON. |
| `sunhat toolchain install` | Download and verify the pinned project toolchain. |
| `sunhat toolchain info` | Print the pinned toolchain metadata. |
| `sunhat toolchain check` | Verify the installed binary digests. |

Arguments after the Sunhat command are passed to Foundry-TRON unchanged.

## Toolchain requirement

`foundry.toml` contains `network = "tron"`. This setting requires the Foundry-TRON fork selected by Sunhat.

Do not run a globally installed `forge` directly. Standard Foundry does not recognize the `tron` network and fails while parsing `foundry.toml`. Use these commands instead:

```bash
sunhat build
sunhat test
```

TRON builds use the native `tron-solc` resolved by Foundry-TRON. `anvil` and `chisel` are unavailable for this target.
