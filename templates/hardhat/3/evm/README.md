# Hardhat 3 EVM Project with Sunhat

This project uses Hardhat 3, Mocha and ethers with an ESM configuration. It is bound to Hardhat/EVM through `sunhat.toml`.

Use Node.js 22.13.0 or newer on a supported even major version. Node.js 24 is the development baseline. Initialization creates files only; install dependencies explicitly:

```bash
npm install
npm run build
npm test
```

The generated `sunhat` dependency aliases `{{sunhatPackage}}`. npm scripts use that project's installed CLI. A global Sunhat command uses the local framework, but does not automatically switch to the project's Sunhat version.

```bash
npx --no-install sunhat build
npx --no-install sunhat test mocha
npx --no-install sunhat run scripts/deploy.ts
```

Hardhat 3's compiler task is `build`. Sunhat forwards commands and arguments unchanged. Tests and scripts obtain ethers from an explicit network connection and close that connection when finished.

This template is for EVM. Hardhat 3/TRON requires a compatible TRON plugin and its own configuration; changing the binding does not install or adapt those components.
