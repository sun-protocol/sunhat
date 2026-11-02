# Sunhat 2 QuickStart

Sunhat runs Hardhat or Foundry using the framework and target recorded in the project. The package name is `@sun-protocol/sunhat`; commands use `sunhat`.

## Requirements

- Node.js **20.11+, 22.x, 24.x, or 26.x** for Sunhat; other majors are rejected. Node.js 20 remains supported and will be deprecated in a future release. Node.js 24 is used for repository development. Hardhat 3 requires **22.13+, 24.x, or 26.x**; the Hardhat 2/TRON plugin requires **22.x, 24.x, or 26.x**.
- Foundry toolchain installation needs access to the configured GitHub release and `tar` on macOS/Linux or PowerShell on Windows. Its installer supports macOS/Linux arm64 and x64, and Windows x64.
- Hardhat projects require **Hardhat 2 or 3**, declared as an exact version matching the installed package. Hardhat TRON tests need a running TRE endpoint. Container startup is disabled by default; Docker is required only if you choose to run TRE in a container. Hardhat 3 support requires this checkout's unpublished 2.1.0 artifact; released 2.0.0 supports the existing Hardhat 2 route.
- First compilation needs network access when the compiler is not already cached.

## Install Sunhat

```bash
npm install --global @sun-protocol/sunhat@2.0.0
sunhat --version
sunhat --help
```

The version command should print `sunhat 2.0.0`. Ensure npm's global executable directory is on `PATH`. The examples below use this global CLI unless stated otherwise.

## Create a project

| Framework | Target            | Command                                                                           |
| --------- | ----------------- | --------------------------------------------------------------------------------- |
| Foundry   | TRON, the default | `sunhat init counter-tron`                                                        |
| Foundry   | EVM               | `sunhat init --target evm counter-evm`                                            |
| Hardhat   | TRON              | `sunhat init --framework hardhat hardhat-tron`                                    |
| Hardhat   | EVM               | `sunhat init --framework hardhat --target evm hardhat-evm`                        |
| Hardhat 3 | TRON              | `sunhat init --framework hardhat --hardhat-version 3 --target tron hardhat3-tron` |
| Hardhat 3 | EVM               | `sunhat init --framework hardhat --hardhat-version 3 --target evm hardhat3-evm`   |

`init` writes project files without downloading toolchains or installing npm packages. It refuses to overwrite existing destination files. For an existing framework project, use [adoption](#adopt-an-existing-project).

### Foundry

```bash
sunhat init counter-tron
cd counter-tron
sunhat toolchain install
sunhat build
sunhat test
```

`sunhat toolchain install` selects the archive for the host OS and CPU architecture, verifies it, and installs Foundry-TRON into the project's `.sunhat/` directory. For an EVM project, use the EVM initialization command from the table; the installation, build, and test commands stay the same.

### Hardhat

```bash
sunhat init --framework hardhat hardhat-tron
cd hardhat-tron
npm install
sunhat compile
export TRE_URL="http://127.0.0.1:9090/jsonrpc"
export TRE_PRIVATE_KEY="<development-private-key>"
sunhat test
```

`npm install` installs Hardhat and its plugins. The TRON template selects `tre` as its default network and sets `tre.autoStart` to `false`. Before running tests, point `TRE_URL` and `TRE_PRIVATE_KEY` at a TRE instance you manage. To opt into automatic container startup, set `tre.autoStart` to `true` in `hardhat.config.ts` and have Docker running.

For EVM, initialize with `--target evm` and use the same install, compile, and test sequence. The EVM template does not load the TRON plugin.

### Hardhat 3 from the development artifact

The two Hardhat 3 commands above require 2.1.0 from this checkout. Build a real archive first; this does not publish it:

```bash
# In the Sunhat checkout:
npm ci
npm pack
npm install --global ./sun-protocol-sunhat-2.1.0.tgz
sunhat init --framework hardhat --hardhat-version 3 --target tron hardhat3-tron
cd hardhat3-tron
npm install --save-dev sunhat@file:/absolute/path/to/sun-protocol-sunhat-2.1.0.tgz
npm run build
TRE_AUTO_START=true npm test
TRE_AUTO_START=true TRE_KEEP_RUNNING=true npx --no-install sunhat node --network tre
```

The last command retains TRE when terminated. In another shell in the generated project, run `npx --no-install sunhat run scripts/deploy.ts --network tre`. For a managed existing TRE, set `TRE_URL` to its HTTP endpoint and `TRE_PRIVATE_KEY` to a `0x`-prefixed signing key instead of enabling startup. The H3 template accepts the base URL or `/jsonrpc` URL. It uses a public development key only for loopback endpoints; a remote endpoint without a key is read-only. Value/balance integers are sun, and receipts retain native resource fields.

For H3/EVM, use the EVM initialization command, install the same local Sunhat archive, then run `npm run build` and `npm test`; no Docker is needed. Hardhat 3 uses `build` and explicit `network.create()` connections. Its TRON and EVM artifacts have separate roots. Patched snapshots/time/account helpers require a separate patched jar; see the [plugin guide](hardhat3-tron-plugin.md). Generated TRON scripts reject EVM connections before writes.

## Use the local CLI and npm scripts

Generated projects declare the creating CLI's npm package and exact version under the `sunhat` alias. Install the generated project's dependencies from its root:

```bash
npm install
```

For Sunhat 2.0.0, the alias is `npm:@sun-protocol/sunhat@2.0.0`. It is independent of the initializing machine's installation path. Commit `package.json` and the package-manager lockfile for reproducible npm dependency installation.

```bash
npx --no-install sunhat --version
npm run build
npm test
```

The generated `build` script runs `sunhat build` for Foundry/Hardhat 3 or `sunhat compile` for Hardhat 2. All templates map `npm test` to `sunhat test`. Forward additional arguments with `npm run build -- <args>` or `npm test -- <args>`.

Global Sunhat resolves the project's framework tools, but it does not switch to the project's Sunhat version. Use `npx --no-install sunhat ...` or the generated npm scripts when you want the local CLI.

### Develop against a local checkout

Run `npm run build` in the Sunhat checkout. In a generated project's root, explicitly point its Sunhat dependency at that checkout:

```bash
npm pkg set "devDependencies.sunhat=file:/absolute/path/to/sunhat2"
npm install
```

Rebuild the checkout after source changes. Restore the registry dependency before sharing the project or committing its dependency configuration.

## Adopt an existing project

Hardhat 3 adoption requires ESM and an exact Hardhat version. Configure/register the native plugins first; a TRON project uses `sunhat/hardhat3-tron`. Then run `sunhat init --adopt --framework hardhat --hardhat-version 3 --target tron`. Adoption only writes the binding and does not migrate configuration, source or dependencies. Plugin availability checks do not prove registration; native configuration and user scripts own network selection. Apply the generated helper's `connection.tre` guard to adapted TRON actions before writes.

Run the appropriate command from a directory containing `foundry.toml` or `hardhat.config.js`, `.cjs`, or `.ts`:

| Existing project | Command                                                  |
| ---------------- | -------------------------------------------------------- |
| Foundry TRON     | `sunhat init --adopt .`                                  |
| Foundry EVM      | `sunhat init --adopt --target evm .`                     |
| Hardhat TRON     | `sunhat init --adopt --framework hardhat .`              |
| Hardhat EVM      | `sunhat init --adopt --framework hardhat --target evm .` |

Adoption preserves native framework configuration, source files, tests, and `package.json`. It adds the Sunhat binding. Foundry adoption also adds `foundry-toolchain.json` if missing; run `sunhat toolchain install` separately. For Hardhat, install the project's declared dependencies separately.

To add a local Sunhat CLI to an adopted project:

```bash
npm install --save-dev --save-exact @sun-protocol/sunhat@2.0.0
```

An already-bound project is rejected by `init`; it is not reinitialized.

## Project configuration

The default binding is:

```toml
[project]
framework = "foundry"
target = "tron"
```

Use `framework = "hardhat"` for Hardhat or `target = "evm"` for EVM. Choose the binding that matches the project's native configuration and installed tools. Changing this file does not rewrite framework configuration or install a different toolchain.

| File                            | Responsibility                                                        |
| ------------------------------- | --------------------------------------------------------------------- |
| `sunhat.toml`                   | Framework and target used for command routing                         |
| `foundry.toml`                  | Foundry compiler, source paths, and network settings                  |
| `hardhat.config.ts`             | Hardhat compiler, plugins, and network settings in generated projects |
| `foundry-toolchain.json`        | Foundry release, platform archives, and installation checksums        |
| `package.json` and its lockfile | npm dependencies and project scripts                                  |

Run commands from the project root or a subdirectory. Sunhat locates the nearest ancestor containing `sunhat.toml` and runs the framework from that project root. See [TOML compatibility](toml-binding.md) for binding syntax details.

## Compiler installation

Compilers are resolved by the framework on first compilation. Foundry toolchain installation does not predownload Solidity compilers.

| Project            | First compilation                                                    | Compiler selection                                                              |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Foundry EVM        | `sunhat build` downloads uncached `solc`                             | Source pragmas or the `solc` setting in `foundry.toml`; the sample uses 0.8.28  |
| Foundry TRON       | `sunhat build` resolves native `tron-solc`                           | `solc` in `foundry.toml`; the selected toolchain defaults to 0.8.28             |
| Hardhat 2 EVM/TRON | After `npm install`, `sunhat compile` resolves the selected compiler | `solidity` in `hardhat.config.ts`; templates select 0.8.26                      |
| Hardhat 3 EVM/TRON | After `npm install`, `sunhat build` resolves the selected compiler   | `solidity` plus the TRON plugin's target/path settings; templates select 0.8.26 |

For example, set this key under the existing `[profile.default]` section in `foundry.toml`:

```toml
solc = "0.8.28"
```

Foundry also accepts a local compiler path through `solc`. Foundry-TRON caches downloaded native compilers under `~/.foundry-tron/solc/`. Hardhat 2/TRON uses the compiler downloader supplied by `@openzeppelin/hardhat-tron`. Hardhat 3/TRON uses the verified downloader adapted in `sunhat/hardhat3-tron` and Hardhat 3's public compiler path setting.

## Common Foundry commands

| Command                                            | Purpose                                                       |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `sunhat build --sizes`                             | Compile and report contract sizes                             |
| `sunhat test -vvv`                                 | Run tests with verbose traces                                 |
| `sunhat test --match-contract CounterTest`         | Run one test contract                                         |
| `sunhat test --gas-report`                         | Report gas on EVM or resources supported by Foundry-TRON      |
| `sunhat snapshot`                                  | Write resource snapshots                                      |
| `sunhat coverage`                                  | Run coverage                                                  |
| `sunhat fmt --check`                               | Check Solidity formatting                                     |
| `sunhat inspect src/Counter.sol:Counter abi`       | Inspect the sample contract ABI                               |
| `sunhat script script/Counter.s.sol:DeployCounter` | Run the sample deployment script without requesting broadcast |
| `sunhat create --help`                             | Show native contract-deployment options                       |
| `sunhat cast --help`                               | Show Cast commands                                            |
| `sunhat clean`                                     | Remove build artifacts and cache                              |
| `sunhat help build`                                | Show Forge build options                                      |
| `sunhat anvil`                                     | Start Anvil, EVM only                                         |
| `sunhat chisel`                                    | Start Chisel, EVM only                                        |

TRON Foundry commands use the project's Foundry-TRON binaries. Anvil and Chisel are unavailable for TRON. RPC URLs, accounts, and broadcast options follow the selected framework's native configuration and CLI.

## Common Hardhat commands

| Command                                | Purpose                              |
| -------------------------------------- | ------------------------------------ |
| `sunhat compile --force`               | Recompile contracts, Hardhat 2       |
| `sunhat build`                         | Compile contracts, Hardhat 3         |
| `sunhat test --grep Counter`           | Run matching tests, Hardhat 2        |
| `sunhat test mocha --grep Counter`     | Run matching tests, Hardhat 3        |
| `sunhat run scripts/deploy.ts`         | Run the generated deployment script  |
| `sunhat node`                          | Run the configured node task         |
| `sunhat console --no-compile`          | Open a console, Hardhat 2            |
| `sunhat flatten contracts/Counter.sol` | Flatten the sample contract          |
| `sunhat clean`                         | Remove artifacts and cache           |
| `sunhat compile --help`                | Show compile-task options, Hardhat 2 |
| `sunhat build --help`                  | Show build-task options, Hardhat 3   |

Plugin tasks are forwarded in the same form: `sunhat <task> [args...]`. Sunhat forwards arguments and the framework's exit status; it does not translate native task names. Use `sunhat compile` with Hardhat 2 and `sunhat build` with Hardhat 3 or Foundry.

## Foundry toolchain installation

After creating or adopting a Foundry project, enter its directory and install the toolchain:

```bash
sunhat toolchain install
sunhat toolchain info
```

`install` installs or reinstalls the release declared in `foundry-toolchain.json`. Normal output is limited to `verify` and `Toolchain installed successfully.` Downloads time out after 60 seconds without receiving data; active transfers can take longer. If installation fails, correct the reported issue and rerun the same command.

`info` prints installed metadata. Archive verification belongs to installation; ordinary execution does not rehash binaries or probe their versions. In a Hardhat project, `toolchain` is forwarded as a native task instead.

## Moving from Sunhat 1.x

Sunhat 1.x is maintenance-only. The v2 CLI does not replace v1's Hardhat plugin APIs, deployment tracking, named accounts, or bundled audit tasks.

1. Review dependencies, configuration imports, deployment scripts, and custom tasks that use the v1 plugin. Configure the native framework and plugins for the features the project needs. Generated v2 templates provide working configuration examples.
2. Bind the project using the matching `init --adopt` command above. Adoption does not rewrite the old plugin configuration or migrate its deployment records.
3. Replace the v1 Sunhat dependency with `@sun-protocol/sunhat@2.0.0` after updating those imports and scripts, then run compilation and tests.

Keep projects that still depend on v1-only APIs pinned to their existing 1.x release until that migration is complete.
