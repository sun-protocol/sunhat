# Hardhat TRON Project with Sunhat

This project uses Sunhat to run Hardhat 2 with the Hardhat-TRON plugin and a TRE development network. The framework and TRON target are fixed in `sunhat.toml`.

## Optional global Sunhat commands

The `sunhat ...` examples use the `{{sunhatPackage}}` npm package. Use Node.js 22.x, 24.x, or 26.x for this project's TRON plugin; other majors are rejected. The Sunhat CLI also retains Node.js 20.11+ for other workflows, with deprecation planned for a future release. Ensure npm's global executable directory is on `PATH`. Install and verify the global CLI with:

```bash
npm install --global {{sunhatPackage}}
sunhat --version
```

For an unpublished local build, install the creating CLI tgz globally instead of requesting that version from the registry.

Run project commands from this directory or a subdirectory after the dependency installation below. Global Sunhat uses the project's local Hardhat 2 and Hardhat-TRON dependencies and configuration.

This project does not declare a Sunhat npm dependency. `npm run build` and `npm test` invoke the project's local Hardhat directly. The `sunhat ...` commands are optional wrappers provided by the globally installed CLI.

The generated configuration sets `tre.autoStart` to `false`. Tests connect to a TRE instance you manage; the default configuration does not start Docker containers.

## Quick start

```bash
npm install
npm run build
export TRE_URL="http://127.0.0.1:9090/jsonrpc"
export TRE_PRIVATE_KEY="<development-private-key>"
npm test
```

The install command installs the declared framework and plugin dependencies. It does not fetch Sunhat.

The generated configuration selects the `tre` network and compiles contracts with `tron-solc`.

## Commands

| Command                        | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `npm run build`                | Compile TRON contracts with `hardhat compile`.       |
| `npm test`                     | Run the test suite against TRE with `hardhat test`.  |
| `sunhat compile --force`       | Recompile all contracts with `tron-solc`.            |
| `sunhat test --grep Counter`   | Run matching tests against TRE.                      |
| `sunhat node`                  | Run the configured Hardhat task.                     |
| `sunhat run scripts/deploy.ts` | Run the deployment script on the configured network. |
| `sunhat clean`                 | Remove generated Hardhat artifacts and cache files.  |
| `sunhat <plugin-task>`         | Run a task registered by a Hardhat plugin.           |

Arguments after the Sunhat command are passed to Hardhat unchanged.

## TRE connection

Configure both variables to connect to an existing TRE instance:

```bash
export TRE_URL="http://127.0.0.1:9090/jsonrpc"
export TRE_PRIVATE_KEY="<development-private-key>"
sunhat test
```

Never use the generated TRE development key on a public network.

To opt into automatic container startup, install and start Docker, then set `tre.autoStart` to `true` in `hardhat.config.ts`. The plugin can then start the configured `tronbox/tre:dev` image when a task needs it.
