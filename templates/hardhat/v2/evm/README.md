# Hardhat EVM Project with Sunhat

This project uses Sunhat to run the locally installed Hardhat 2 toolchain for an EVM target. The framework and target are fixed in `sunhat.toml`.

## Optional global Sunhat commands

The `sunhat ...` examples use the `{{sunhatPackage}}` npm package. Use Node.js 20.11+, 22.x, 24.x, or 26.x; other majors are rejected. Node.js 20 remains supported and will be deprecated in a future release. Ensure npm's global executable directory is on `PATH`. Install and verify the global CLI with:

```bash
npm install --global {{sunhatPackage}}
sunhat --version
```

For an unpublished local build, install the creating CLI tgz globally instead of requesting that version from the registry.

Run project commands from this directory or a subdirectory after the dependency installation below. Global Sunhat uses the project's local Hardhat 2 dependency and configuration.

This project does not declare a Sunhat npm dependency. `npm run build` and `npm test` invoke the project's local Hardhat directly. The `sunhat ...` commands are optional wrappers provided by the globally installed CLI.

## Quick start

```bash
npm install
npm run build
npm test
```

The install command installs the declared framework and plugin dependencies. It does not fetch Sunhat.

## Commands

| Command                        | Purpose                                             |
| ------------------------------ | --------------------------------------------------- |
| `npm run build`                | Compile contracts with `hardhat compile`.           |
| `npm test`                     | Run the Hardhat test suite with `hardhat test`.     |
| `sunhat compile --force`       | Recompile all contracts.                            |
| `sunhat test --grep Counter`   | Run matching tests.                                 |
| `sunhat node`                  | Start the configured local EVM network.             |
| `sunhat run scripts/deploy.ts` | Run the deployment script.                          |
| `sunhat clean`                 | Remove generated Hardhat artifacts and cache files. |
| `sunhat <plugin-task>`         | Run a task registered by a Hardhat plugin.          |

Arguments after the Sunhat command are passed to Hardhat unchanged.
