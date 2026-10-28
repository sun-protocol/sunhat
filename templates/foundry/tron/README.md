# Foundry TRON Project with Sunhat

This project uses Sunhat to select and run a project-local Foundry-TRON toolchain. The framework and TRON target are fixed in `sunhat.toml`.

## Global command prerequisites

The `sunhat ...` examples use the `{{sunhatPackage}}` npm package. Use Node.js `>=20.11` and ensure npm's global executable directory is on `PATH`. Install and verify the global CLI with:

```bash
npm install --global {{sunhatPackage}}
sunhat --version
```

Run project commands from this directory or a subdirectory. Install the Foundry-TRON toolchain with the command below before building or testing. Global Sunhat uses the binaries in this project's `.sunhat/` directory. Anvil and Chisel are unavailable for TRON.

The generated project declares `{{sunhatPackage}}` as an exact local development dependency under the `sunhat` alias. For local-only use, replace `sunhat` with `npx --no-install sunhat` in the examples. `npm run build` and `npm test` use the project's local Sunhat automatically. A global invocation does not automatically switch to the local Sunhat copy.

## Quick start

```bash
npm install
sunhat toolchain install
npm run build
npm test
```

The install command installs all declared dependencies. The Sunhat dependency uses an npm alias that is independent of the machine that initialized this project.

`sunhat init` only generates project files. `sunhat toolchain install` installs and verifies the release declared in `foundry-toolchain.json` and stores the binaries under `.sunhat/toolchains/`. Subsequent commands run the installed executables without rehashing them or probing their versions. If installation fails, retry with the same install command. Use `toolchain info` to inspect installed metadata.

## Commands

| Command                                    | Purpose                                                  |
| ------------------------------------------ | -------------------------------------------------------- |
| `npm run build`                            | Compile contracts with `sunhat build`.                   |
| `npm test`                                 | Run tests on the TRON execution path with `sunhat test`. |
| `sunhat build --sizes`                     | Compile contracts and report contract sizes.             |
| `sunhat test -vvv`                         | Run tests with verbose traces.                           |
| `sunhat test --match-contract CounterTest` | Run one test contract.                                   |
| `sunhat test --gas-report`                 | Report energy and bandwidth usage.                       |
| `sunhat snapshot`                          | Record energy snapshots.                                 |
| `sunhat coverage`                          | Generate a coverage report.                              |
| `sunhat script <path>`                     | Run a Foundry script.                                    |
| `sunhat create <contract>`                 | Deploy a contract through the TRON transaction path.     |
| `sunhat cast <command>`                    | Run a Cast command through Foundry-TRON.                 |
| `sunhat toolchain install`                 | Install or reinstall the configured toolchain.           |
| `sunhat toolchain info`                    | Print the pinned toolchain metadata.                     |

Arguments after the Sunhat command are passed to Foundry-TRON unchanged.

## Toolchain requirement

`foundry.toml` contains `network = "tron"`. This setting requires the Foundry-TRON fork selected by Sunhat.

Do not run a globally installed `forge` directly. Standard Foundry does not recognize the `tron` network and fails while parsing `foundry.toml`. Use these commands instead:

```bash
sunhat build
sunhat test
```

The first `sunhat build` downloads native `tron-solc` through Foundry-TRON. The current toolchain defaults to `0.8.28` and caches it under `~/.foundry-tron/solc/`. Set `solc` under `[profile.default]` in `foundry.toml` to select a version or local executable. Initialization does not predownload the compiler. `anvil` and `chisel` are unavailable for this target.
