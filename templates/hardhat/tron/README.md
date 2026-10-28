# Hardhat TRON Project with Sunhat

This project uses Sunhat to run Hardhat 2 with the Hardhat-TRON plugin and a TRE development network. The framework and TRON target are fixed in `sunhat.toml`.

## Global command prerequisites

The `sunhat ...` examples use the `{{sunhatPackage}}` npm package. Use Node.js `>=20.11` and ensure npm's global executable directory is on `PATH`. Install and verify the global CLI with:

```bash
npm install --global {{sunhatPackage}}
sunhat --version
```

Run project commands from this directory or a subdirectory after the dependency installation below. Global Sunhat uses the project's local Hardhat 2 and Hardhat-TRON dependencies and configuration.

The generated project declares `{{sunhatPackage}}` as an exact local development dependency under the `sunhat` alias. For local-only use, replace `sunhat` with `npx --no-install sunhat` in the examples. `npm run build` and `npm test` use the project's local Sunhat automatically. A global invocation does not automatically switch to the local Sunhat copy.

Docker must be installed and running. The generated configuration starts `tronbox/tre:dev` automatically when required.

## Quick start

```bash
npm install
npm run build
npm test
```

The install command installs all declared dependencies. The Sunhat dependency uses an npm alias that is independent of the machine that initialized this project.

The generated configuration selects the `tre` network and compiles contracts with `tron-solc`.

## Commands

| Command                        | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `npm run build`                | Compile TRON contracts with `sunhat compile`.        |
| `npm test`                     | Run the test suite against TRE with `sunhat test`.   |
| `sunhat compile --force`       | Recompile all contracts with `tron-solc`.            |
| `sunhat test --grep Counter`   | Run matching tests against TRE.                      |
| `sunhat node`                  | Run the configured Hardhat task.                     |
| `sunhat run scripts/deploy.ts` | Run the deployment script on the configured network. |
| `sunhat clean`                 | Remove generated Hardhat artifacts and cache files.  |
| `sunhat <plugin-task>`         | Run a task registered by a Hardhat plugin.           |

Arguments after the Sunhat command are passed to Hardhat unchanged.

## External TRE instance

Set `tre.autoStart` to `false` in `hardhat.config.ts`, then configure both variables to use an existing TRE instance:

```bash
export TRE_URL="http://127.0.0.1:9090/jsonrpc"
export TRE_PRIVATE_KEY="<development-private-key>"
sunhat test
```

Never use the generated TRE development key on a public network.
