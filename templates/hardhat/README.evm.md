# Hardhat EVM Project with Sunhat

This project uses Sunhat to run the locally installed Hardhat 2 toolchain for an EVM target. The framework and target are fixed in `sunhat.toml`.

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
| `npx sunhat compile --force` | Recompile all contracts. |
| `npx sunhat test --grep Counter` | Run matching tests. |
| `npx sunhat node` | Start the configured local EVM network. |
| `npx sunhat run scripts/deploy.ts` | Run the deployment script. |
| `npx sunhat clean` | Remove generated Hardhat artifacts and cache files. |
| `npx sunhat <plugin-task>` | Run a task registered by a Hardhat plugin. |

Arguments after the Sunhat command are passed to Hardhat unchanged.
