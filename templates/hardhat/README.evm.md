# Hardhat EVM Project with Sunhat

This project uses Sunhat to run the locally installed Hardhat 2 toolchain for an EVM target. The framework and target are fixed in `sunhat.toml`.

## Global command prerequisites

The `sunhat ...` examples require Sunhat 2.0.0 installed globally and npm's global executable directory on `PATH`. Verify the installation with `sunhat --version`. To install from a Sunhat source checkout, run `npm install`, `npm run build`, and `npm install --global .` in that checkout, not in this generated project.

Run project commands from this directory or a subdirectory after `npm install`. Global Sunhat uses the project's local Hardhat 2 dependency and configuration.

For a local-only installation, replace `sunhat` with `npx --no-install sunhat` in the examples after running `npm install`. `npm run build` and `npm test` use the project's local Sunhat automatically. A global invocation does not automatically switch to the local Sunhat copy.

## Quick start

```bash
npm install
npm run build
npm test
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile contracts with `sunhat compile`. |
| `npm test` | Run the Hardhat test suite with `sunhat test`. |
| `sunhat compile --force` | Recompile all contracts. |
| `sunhat test --grep Counter` | Run matching tests. |
| `sunhat node` | Start the configured local EVM network. |
| `sunhat run scripts/deploy.ts` | Run the deployment script. |
| `sunhat clean` | Remove generated Hardhat artifacts and cache files. |
| `sunhat <plugin-task>` | Run a task registered by a Hardhat plugin. |

Arguments after the Sunhat command are passed to Hardhat unchanged.
