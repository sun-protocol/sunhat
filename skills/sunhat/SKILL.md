---
name: sunhat
description: Initialize, compile, test, deploy, recover, or audit Hardhat 3 projects that use the Sunhat EVM/TRON build and verification workflow.
---

# Sunhat Contract Lifecycle

Use the project-local `sunhat` command and its `hardhat.config.ts` as the single configuration source. Read only the workflow needed for the request; for a multi-stage request, read the workflows in execution order.

| Objective | Workflow |
| --- | --- |
| Initialize a project | [sunhat-init.md](workflows/sunhat-init.md) |
| Compile Solidity, tron-solc, or Vyper targets | [sunhat-compile.md](workflows/sunhat-compile.md) |
| Run Hardhat 3 TypeScript or native Solidity tests | [sunhat-test.md](workflows/sunhat-test.md) |
| Audit contract code and verify findings | [sunhat-audit.md](workflows/sunhat-audit.md) |
| Deploy or recover a verification archive | [sunhat-deploy.md](workflows/sunhat-deploy.md) |

## Invariants

- Never infer a compiler target from a `.sol` extension. Use `sunhat.compilation.targets` and the network binding.
- Never substitute EVM solc for tron-solc or run a TRON target on EDR.
- Treat compiler path and SHA-256 mismatches as build failures.
- Do not rebroadcast a deployment with an unknown outcome; recover it with `sunhat verification sync`.
- Before any external network broadcast, report the network, deployer, selected target/scripts, value, and exact command, then obtain explicit confirmation.
- Sunhat 2.0 alpha rejects TRON broadcast and sync until the real TVM matrix is complete. Do not bypass that guard with direct raw transactions.
