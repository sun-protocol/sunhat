# Foundry EVM Project with Sunhat

This project uses Sunhat to select and run a project-local Foundry toolchain for an EVM target. The framework and target are fixed in `sunhat.toml`.

## Global command prerequisites

The `sunhat ...` examples require Sunhat 2.0.0 installed globally and npm's global executable directory on `PATH`. Verify the installation with `sunhat --version`. To install from a Sunhat source checkout, run `npm install`, `npm run build`, and `npm install --global .` in that checkout, not in this generated project.

Run project commands from this directory or a subdirectory. Install the project-pinned Foundry toolchain with `sunhat toolchain install` before building, testing, or using Cast, Anvil, or Chisel. Global Sunhat still uses the binaries in this project's `.sunhat/` directory.

For a local-only installation, replace `sunhat` with `npx --no-install sunhat` in the examples after running `npm install`. `npm run build` and `npm test` use the project's local Sunhat automatically. A global invocation does not automatically switch to the local Sunhat copy.

## Quick start

```bash
npm install
sunhat toolchain install
sunhat toolchain check
npm run build
npm test
```

`toolchain install` downloads the Foundry release pinned by Sunhat and stores it under `.sunhat/toolchains/`. Subsequent commands verify the executable digest before running it.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile contracts with `sunhat build`. |
| `npm test` | Run the Foundry test suite with `sunhat test`. |
| `sunhat build --sizes` | Compile contracts and report contract sizes. |
| `sunhat test -vvv` | Run tests with verbose traces. |
| `sunhat test --match-contract CounterTest` | Run one test contract. |
| `sunhat snapshot` | Record gas snapshots. |
| `sunhat coverage` | Generate a coverage report. |
| `sunhat script <path>` | Run a Foundry script. |
| `sunhat create <contract>` | Deploy a contract with Forge. |
| `sunhat cast <command>` | Run a Cast command through the selected toolchain. |
| `sunhat anvil` | Start the project-pinned Anvil node. |
| `sunhat chisel` | Start the project-pinned Solidity REPL. |
| `sunhat toolchain install` | Download and verify the pinned project toolchain. |
| `sunhat toolchain info` | Print the pinned toolchain metadata. |
| `sunhat toolchain check` | Verify the installed binary digests. |

Arguments after the Sunhat command are passed to Foundry unchanged.
