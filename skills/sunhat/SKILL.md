---
name: sunhat
description: Initialize, compile, test, deploy, or audit TRON smart contract projects that use the Sunhat Hardhat plugin.
---

# Sunhat TRON Development Skill

Use this skill to operate the Sunhat lifecycle for TRON smart contracts.

**Rule:** Read only the workflow file relevant to the current objective. If the request spans multiple objectives, read the required workflows in execution order.

## Capabilities

| Objective | Workflow File | Description |
| :--- | :--- | :--- |
| **Initialize Project** | [sunhat-init.md](workflows/sunhat-init.md) | Setup new project structure, config, and env. |
| **Compile Contracts** | [sunhat-compile.md](workflows/sunhat-compile.md) | Compile Solidity/Vyper with TRON settings. |
| **Run Tests** | [sunhat-test.md](workflows/sunhat-test.md) | Run Foundry (Solidity) or Hardhat (JS) tests. |
| **Security Audit** | [sunhat-audit.md](workflows/sunhat-audit.md) | **White Hat** Analyze, Exploit (PoC), and Report. |
| **Deploy to Network** | [sunhat-deploy.md](workflows/sunhat-deploy.md) | Deploy contracts to Mainnet/Nile/Shasta. |

## Quick Reference

- **CLI Tool**: `sunhat` (implicitly wraps Hardhat)
- **Config**: `hardhat.config.ts`
- **Networks**: `tron` (alias for configured TRON network)
