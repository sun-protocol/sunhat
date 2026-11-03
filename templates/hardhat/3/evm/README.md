# Hardhat 3 EVM Project with Sunhat

This project uses Hardhat 3, Mocha and ethers with an ESM configuration. It is bound to Hardhat/EVM through `sunhat.toml`.

Use Node.js 22.13+, 24.x, or 26.x. Other major versions are outside the supported template engines. Node.js 24 is the development baseline. Node.js 20 is retained only for older Sunhat workflows and will be deprecated in a future release; it cannot run Hardhat 3. Initialization creates files only; install dependencies explicitly:

```bash
npm install
npm run build
npm test
```

This project does not declare a Sunhat npm dependency. Its npm scripts invoke the local Hardhat directly. Optional global routing is available through `{{sunhatPackage}}`; a global Sunhat command uses this project's native framework.

```bash
npx --no-install hardhat build
npx --no-install hardhat test mocha
npx --no-install hardhat run scripts/deploy.ts
```

Hardhat 3's compiler task is `build`. Sunhat forwards commands and arguments unchanged. Tests and scripts use `helpers/connection.ts` to obtain ethers from an explicit network connection and close it when finished. If the operation and cleanup both fail, the original exception is rethrown and the cleanup error is reported separately. A cleanup-only failure is propagated.

This template is for EVM. Generate a separate Hardhat 3/TRON project with `--hardhat-version 3 --target tron` for the native TRON plugin and configuration. Changing an existing binding does not migrate plugins or source code.
