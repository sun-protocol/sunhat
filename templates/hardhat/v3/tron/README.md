# Hardhat 3 TRON project with Sunhat

This project compiles TVM bytecode and uses the Sunhat TRON plugin through explicit Hardhat 3 connections. Use Node.js 22.13+, 24.x or 26.x. Initialization writes files only.

```bash
npm install
npm run build
TRE_AUTO_START=true npm test
TRE_AUTO_START=true TRE_KEEP_RUNNING=true npx sunhat node --network tre
npx sunhat run scripts/deploy.ts --network tre
```

Automatic startup is disabled by default. The test command above opts into local Docker TRE; only its owned container is removed after the test. The persistent node command retains the container when terminated. For an existing TRE, set `TRE_URL` to its base HTTP URL and omit automatic startup. The default pinned image uses a public development mnemonic; the template's default key matches that mnemonic and is selected only for loopback endpoints. Remote endpoints without `TRE_PRIVATE_KEY` remain read-only. Keep private keys outside project files.

This is the only template that declares a Sunhat npm dependency: the plugin imported from `sunhat/hardhat3-tron` is supplied by `{{sunhatPackage}}`. Its npm scripts invoke local Hardhat directly. During development before registry publication, install the locally packed Sunhat tgz as the `sunhat` dev dependency. The existing released 2.0.0 CLI does not contain this integration.

Compilation explicitly selects `tron-solc` through `tre.compiler.target: 'tron'`, independently of the default network. The plugin downloads and verifies the TVM compiler; `TRON_SOLC_PATH` selects an existing copy with the same required checksum. The npm `solc` dependency supplies compiler wrapper utilities, not the compiler used for TRON builds. TRON artifacts live in `artifacts-tron`. Use a separate configuration with `tre.compiler.target: 'evm'` to build EVM artifacts. The generated connection helper rejects EVM connections before running test/deployment actions.

The native ethers facade uses sun for value and balance integers. Receipts retain native transaction IDs, Energy/Bandwidth and original transaction information. Ordinary TRE supports the generated build/test/deploy flow. Snapshot, fixture, time and account-mutation helpers need a patched jar; set `TRE_JAR_PATH` to that jar's absolute path before starting a fresh container. Patched snapshots restore account/contract state and retain transaction/block history. Close connections after use; the shared helper preserves the original operation exception when cleanup also fails.

Hardhat 2/TRON plugins and upgrade plugins must not be imported into this configuration. Existing Hardhat 2 projects can retain their original configuration and dependencies. Adoption only writes `sunhat.toml`; it does not migrate code or install plugins.
