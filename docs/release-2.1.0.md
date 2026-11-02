# Sunhat 2.1.0 development release notes

Status: unpublished. This checkout adds Hardhat 3 on EVM and TRON while retaining the Hardhat 2 and Foundry routes. The released 2.0.0 artifact remains unchanged.

- Initialize ESM Hardhat 3 projects with `--framework hardhat --hardhat-version 3 --target evm|tron`. Hardhat initialization still defaults to version 2. Init writes files without installing dependencies; adopt preserves native configuration and source.
- Import the native TRON plugin through `@sun-protocol/sunhat/hardhat3-tron`, or `sunhat/hardhat3-tron` through the generated alias. It reuses the attributed OpenZeppelin TRON runtime/facade and Docker lifecycle through connection-scoped factories and public Hardhat 3 hooks.
- Compile checksum-verified TVM bytecode, keep EVM/TRON artifacts separate, and use native deployments, calls, events and receipts through `connection.ethers`. Original TRON IDs and Energy/Bandwidth fields remain inspectable. Values and balances use sun.
- Retain opt-in Docker TRE startup, existing-node reuse, owned-container cleanup and persistent node mode. Ordinary TRE supports the generated lifecycle. Patched TRE adds snapshots/fixtures, time and account mutation/impersonation; snapshots restore account/contract state while retaining block/transaction history.
- Preserve the original operation exception if cleanup fails. Dependency, invalid signing-account and wrong generated-network errors fail explicitly.

Use Node.js 22.13+, 24.x or 26.x for Hardhat 3. The CLI continues to support only Node 20.11+, 22.x, 24.x and 26.x; Node 20 will be deprecated in a future release. Framework dependencies remain consumer-owned, with exact template versions and optional peers that do not force Hardhat 3 into existing CLI/Hardhat 2 installations.

Hardhat 2 plugins cannot be imported directly into Hardhat 3. Upgrade plugins, forks, coverage and Solidity tests need separate acceptance. Runtime execution checks installed plugin availability. Adoption preserves user configuration and source; registration and network selection remain project-owned. See the [plugin guide](hardhat3-tron-plugin.md), [compatibility evidence](hardhat3-compatibility.md) and [staged review records](hardhat3-tron-development-plan.md) before migration. Use a locally packed tgz until 2.1.0 is published.
