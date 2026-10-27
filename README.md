# Sunhat

Sunhat's npm package is `sunhat`; these instructions use version `2.0.0`. It binds a project to Hardhat 2 or Foundry and to an EVM or TRON target through `sunhat.toml`. It handles project initialization, binding, command routing, and child-process management without replacing the framework's compiler, test runner, or argument parser.

## Global command prerequisites

To run `sunhat ...` directly in a terminal, install `sunhat@2.0.0` from npm globally and ensure npm's global executable directory is on `PATH`. The CLI requires Node.js `>=20.11`.

```bash
npm install --global sunhat@2.0.0
sunhat --version
sunhat --help
```

`sunhat --version` should report `sunhat 2.0.0`. Global installation is a separate step; `sunhat init` does not perform it.

These commands are available without a project binding:

| Command | Purpose |
| --- | --- |
| `sunhat`, `sunhat --help`, `sunhat -h` | Print CLI usage and initialization defaults. |
| `sunhat --version`, `sunhat -V` | Print the version of the invoked Sunhat executable. |
| `sunhat init [options] [path]` | Create a project, or bind an existing project with `--adopt`. |

All other commands require a valid `sunhat.toml` in the current directory or an ancestor. Run them from the project root or one of its subdirectories. Global Sunhat still resolves Hardhat from the project's dependencies and Foundry from the project's `.sunhat/` toolchain; global installation does not install either framework for the project.

Install `sunhat@2.0.0` as an exact local development dependency using the project setup steps below. Then use `npx --no-install sunhat ...` to run that local copy without a global installation. The examples below use the global `sunhat` command; replace it with `npx --no-install sunhat` for local use. `npm run build` and `npm test` resolve the local executable automatically.

The global CLI does not automatically delegate to the project's local Sunhat copy. Use `sunhat --version` and `npx --no-install sunhat --version` to check which CLI version each invocation uses.

## Initialize or adopt a project

New projects use Foundry and the TRON target by default. Pass `--framework hardhat` to select Hardhat, or `--target evm` to select an EVM target:

```bash
sunhat init contracts
sunhat init --target evm contracts-evm
sunhat init --framework hardhat hardhat-tron
sunhat init --framework hardhat --target evm hardhat-evm
```

Adopting an existing project does not modify its native configuration. Adoption also defaults to the TRON target; pass `--target evm` explicitly for an EVM project:

```bash
sunhat init --adopt .
sunhat init --framework hardhat --adopt --target evm .
```

The binding file is the sole source of truth for command routing:

```toml
[project]
framework = "hardhat"
target = "evm"
```

Initialization uses exclusive file creation. It fails if a destination file already exists and never overwrites unknown content. Dependency installation remains under the project's control.

After initialization, enter the project directory and install its dependencies:

```bash
cd contracts
npm install --save-dev --save-exact sunhat@2.0.0
```

This command installs the project's declared dependencies and pins its local Sunhat to `2.0.0` from npm. The current scaffold initially writes a `file:` reference to the Sunhat installation that created it; the command replaces that reference so the project no longer depends on that installation path. Run the same installation command in an adopted project's root.

## Project commands

The following lists use a globally installed Sunhat and require the project binding described above. Native command availability and options are determined by the project's installed framework and plugins.

### Hardhat projects: EVM and TRON

Complete the project dependency installation above first. Hardhat must be declared with an exact version matching the installed Hardhat 2 package.

| Command | Purpose |
| --- | --- |
| `sunhat compile [--force]` | Compile contracts, optionally forcing recompilation. |
| `sunhat test [--grep Counter]` | Run all tests or matching tests. |
| `sunhat run scripts/deploy.ts` | Run the deployment script on the configured network. |
| `sunhat node` | Run the configured Hardhat node task. |
| `sunhat console [--no-compile]` | Open the Hardhat console. |
| `sunhat flatten contracts/Counter.sol` | Print flattened contract source. |
| `sunhat clean` | Remove Hardhat artifacts and cache. |
| `sunhat help [task]` | List native tasks or show help for one task. |
| `sunhat <plugin-task> [args...]` | Forward a task registered by an installed plugin. |

### Foundry projects: EVM and TRON

Install the project toolchain with `sunhat toolchain install` before running native commands. The installer requires access to the pinned GitHub release and `tar` on macOS/Linux or PowerShell on Windows. It supports macOS/Linux arm64 and x64, and Windows x64.

| Command | Purpose | Target |
| --- | --- | --- |
| `sunhat toolchain install` | Download and verify the pinned project toolchain. | EVM, TRON |
| `sunhat toolchain check` | Verify the installed binary digests. | EVM, TRON |
| `sunhat toolchain info` | Print the installed toolchain metadata. | EVM, TRON |
| `sunhat build [--sizes]` | Compile contracts and optionally report sizes. | EVM, TRON |
| `sunhat test [-vvv]` | Run tests, optionally with verbose traces. | EVM, TRON |
| `sunhat test --match-contract CounterTest` | Run one test contract. | EVM, TRON |
| `sunhat test --gas-report` | Request the selected toolchain's resource report. | EVM, TRON |
| `sunhat snapshot` | Record resource usage snapshots. | EVM, TRON |
| `sunhat coverage` | Generate a coverage report. | EVM, TRON |
| `sunhat script <path>` | Run a Foundry script. | EVM, TRON |
| `sunhat create <contract>` | Deploy a contract with the selected toolchain. | EVM, TRON |
| `sunhat clean` | Remove build artifacts and cache. | EVM, TRON |
| `sunhat fmt --check` | Check Solidity formatting. | EVM, TRON |
| `sunhat inspect <contract> abi` | Print a contract's ABI. | EVM, TRON |
| `sunhat cast <command> [args...]` | Run Cast from the project toolchain. | EVM, TRON |
| `sunhat anvil [args...]` | Start the project-pinned local EVM node. | EVM only |
| `sunhat chisel [args...]` | Open the project-pinned Solidity REPL. | EVM only |
| `sunhat help [command]` | Show native Forge help. | EVM, TRON |

Other native Forge commands are forwarded as `sunhat <command> [args...]`. The `toolchain` commands above are managed by Sunhat only for Foundry bindings; in a Hardhat project, the same arguments are forwarded to Hardhat as a native task.

Sunhat does not rewrite core commands across frameworks. Compile Hardhat projects with `sunhat compile` and Foundry projects with `sunhat build`. Based on the `sunhat.toml` binding, Sunhat forwards each command and its arguments directly to the selected framework. The former `sunhat hardhat ...` and `sunhat foundry ...` three-part command forms are no longer supported. Anvil and Chisel are unavailable for TRON Foundry projects.

The target project must install Hardhat major version 2. The current template pins `hardhat@2.29.1`, which supports Node.js 24. Sunhat resolves the absolute Hardhat entry point from the project's dependencies and does not invoke `npx`.

Hardhat TRON projects require a running Docker daemon. Their generated configuration selects the `tre` network, compiles with `tron-solc`, and starts `tronbox/tre:dev` automatically for `sunhat test`. Set `TRE_URL` and `TRE_PRIVATE_KEY` to use an existing TRE instance instead of the generated local defaults.

Hardhat dependencies use exact versions published on the npm registry. Sunhat's project dependency is pinned to `sunhat@2.0.0` by the installation step above. Foundry binaries are installed separately from pinned GitHub releases. In a Foundry project, install and check the toolchain with:

```bash
sunhat toolchain install
sunhat toolchain check
```

EVM projects download `foundry-rs/foundry@v1.8.6`. TRON projects download the public release for `elsvv/foundry-tron@9ea07db4b342fd606f6f7c3f99be1757e90d5e90`. Sunhat verifies the archive against a pinned SHA-256 digest before extracting it to `.sunhat/toolchains/`, then verifies the selected binary's digest on every invocation.

Installation stages all binaries on the project's toolchain filesystem before replacing an existing installation. The previous directory is kept until the new lock file is committed. If activation or lock replacement fails, Sunhat restores the previous directory; if restoration also fails, it retains the backup and reports its location.

Child processes receive a structured argv array and run with `shell: false`. They inherit stdout and stderr, and Sunhat forwards SIGINT, SIGTERM, and the native exit status.

## Development

Run these commands from a Sunhat source checkout:

```bash
npm install
npm test
```

`npm test` builds Sunhat, initializes all four framework/target combinations, and exercises the commands listed in the generated READMEs, npm scripts, argument forwarding, subdirectory resolution, exit codes, and toolchain rejection paths. Framework executables and download responses are fixtures; the suite does not run Solidity compilers, Docker/TRE, or real deployments.
