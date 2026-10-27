# Foundry EVM Project with Sunhat

This project uses Sunhat to select and run a project-local Foundry toolchain for an EVM target. The framework and target are fixed in `sunhat.toml`.

## Global command prerequisites

The `sunhat ...` examples use the `sunhat@2.0.0` npm package. Use Node.js `>=20.11` and ensure npm's global executable directory is on `PATH`. Install and verify the global CLI with:

```bash
npm install --global sunhat@2.0.0
sunhat --version
```

Run project commands from this directory or a subdirectory. `sunhat init` has already installed the Foundry toolchain. Global Sunhat uses the binaries in this project's `.sunhat/` directory.

The quick start also installs `sunhat@2.0.0` as an exact local development dependency. For local-only use, replace `sunhat` with `npx --no-install sunhat` in the examples. `npm run build` and `npm test` use the project's local Sunhat automatically. A global invocation does not automatically switch to the local Sunhat copy.

## Quick start

```bash
npm install --save-dev --save-exact sunhat@2.0.0
npm run build
npm test
```

The install command replaces the scaffold's `file:` Sunhat reference with the npm version and installs the project's other declared dependencies.

`sunhat init` installs and verifies the release declared in `foundry-toolchain.json` and stores the binaries under `.sunhat/toolchains/`. Subsequent commands run the installed executables without rehashing them or probing their versions. If initialization reported an installation failure, retry with `sunhat toolchain install`. Use `toolchain info` to inspect installed metadata.

The first `sunhat build` downloads the `solc` version required by the sources if it is not cached. To select the compiler explicitly, set `solc = "0.8.28"` under `[profile.default]` in `foundry.toml`. Initialization does not predownload the compiler.

## Commands

| Command                                    | Purpose                                            |
| ------------------------------------------ | -------------------------------------------------- |
| `npm run build`                            | Compile contracts with `sunhat build`.             |
| `npm test`                                 | Run the Foundry test suite with `sunhat test`.     |
| `sunhat build --sizes`                     | Compile contracts and report contract sizes.       |
| `sunhat test -vvv`                         | Run tests with verbose traces.                     |
| `sunhat test --match-contract CounterTest` | Run one test contract.                             |
| `sunhat snapshot`                          | Record gas snapshots.                              |
| `sunhat coverage`                          | Generate a coverage report.                        |
| `sunhat script <path>`                     | Run a Foundry script.                              |
| `sunhat create <contract>`                 | Deploy a contract with Forge.                      |
| `sunhat cast <command>`                    | Run a Cast command through the selected toolchain. |
| `sunhat anvil`                             | Start the project-pinned Anvil node.               |
| `sunhat chisel`                            | Start the project-pinned Solidity REPL.            |
| `sunhat toolchain install`                 | Retry or reinstall the configured toolchain.       |
| `sunhat toolchain info`                    | Print the pinned toolchain metadata.               |

Arguments after the Sunhat command are passed to Foundry unchanged.
