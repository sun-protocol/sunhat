# Hardhat 3 EVM Project with Sunhat

This project uses Hardhat 3, Mocha and ethers with an ESM configuration. It is bound to Hardhat/EVM through `sunhat.toml`.

Use Node.js 22.13+, 24.x, or 26.x. Other major versions are rejected. Node.js 24 is the development baseline. Node.js 20 is retained only for older Sunhat workflows and will be deprecated in a future release; it cannot run Hardhat 3. Initialization creates files only; install dependencies explicitly:

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

Hardhat 3's compiler task is `build`. Sunhat forwards commands and arguments unchanged. Tests and scripts use `helpers/connection.ts` to obtain ethers from an explicit network connection and close it when finished. If the operation and cleanup both fail, the original exception is rethrown and the cleanup error is reported separately. A cleanup-only failure is propagated.

This template is for EVM. Hardhat 3/TRON requires a compatible TRON plugin and its own configuration; changing the binding does not install or adapt those components.
