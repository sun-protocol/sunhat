# Hardhat TRON Project with Sunhat

This project uses Sunhat to run Hardhat 2 with the Hardhat-TRON plugin and a TRE development network. The framework and TRON target are fixed in `sunhat.toml`.

## Prerequisite

Docker must be installed and running. The generated configuration starts `tronbox/tre:dev` automatically when required.

## Quick start

```bash
npm install
npm run build
npm test
```

The generated configuration selects the `tre` network and compiles contracts with `tron-solc`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Compile TRON contracts with `sunhat compile`. |
| `npm test` | Run the test suite against TRE with `sunhat test`. |
| `npx sunhat compile --force` | Recompile all contracts with `tron-solc`. |
| `npx sunhat test --grep Counter` | Run matching tests against TRE. |
| `npx sunhat node` | Run the configured Hardhat task. |
| `npx sunhat run scripts/deploy.ts` | Run the deployment script on the configured network. |
| `npx sunhat clean` | Remove generated Hardhat artifacts and cache files. |
| `npx sunhat <plugin-task>` | Run a task registered by a Hardhat plugin. |

Arguments after the Sunhat command are passed to Hardhat unchanged.

## External TRE instance

Set both variables to use an existing TRE instance instead of the generated local defaults:

```bash
export TRE_URL="http://127.0.0.1:9090/jsonrpc"
export TRE_PRIVATE_KEY="<development-private-key>"
npx sunhat test
```

Never use the generated TRE development key on a public network.
