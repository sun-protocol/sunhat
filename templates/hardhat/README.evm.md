# Hardhat EVM Project with Sunhat

This project uses Sunhat to run the locally installed Hardhat 2 toolchain for an EVM target. The framework and target are fixed in `sunhat.toml`.

## Global command prerequisites

The `sunhat ...` examples use the `sunhat@2.0.0` npm package. Use Node.js `>=20.11` and ensure npm's global executable directory is on `PATH`. Install and verify the global CLI with:

```bash
npm install --global sunhat@2.0.0
sunhat --version
```

Run project commands from this directory or a subdirectory after the dependency installation below. Global Sunhat uses the project's local Hardhat 2 dependency and configuration.

The quick start also installs `sunhat@2.0.0` as an exact local development dependency. For local-only use, replace `sunhat` with `npx --no-install sunhat` in the examples. `npm run build` and `npm test` use the project's local Sunhat automatically. A global invocation does not automatically switch to the local Sunhat copy.

## Quick start

```bash
npm install --save-dev --save-exact sunhat@2.0.0
npm run build
npm test
```

The install command replaces the scaffold's `file:` Sunhat reference with the npm version and installs the project's other declared dependencies.

## Commands

| Command                        | Purpose                                             |
| ------------------------------ | --------------------------------------------------- |
| `npm run build`                | Compile contracts with `sunhat compile`.            |
| `npm test`                     | Run the Hardhat test suite with `sunhat test`.      |
| `sunhat compile --force`       | Recompile all contracts.                            |
| `sunhat test --grep Counter`   | Run matching tests.                                 |
| `sunhat node`                  | Start the configured local EVM network.             |
| `sunhat run scripts/deploy.ts` | Run the deployment script.                          |
| `sunhat clean`                 | Remove generated Hardhat artifacts and cache files. |
| `sunhat <plugin-task>`         | Run a task registered by a Hardhat plugin.          |

Arguments after the Sunhat command are passed to Hardhat unchanged.
