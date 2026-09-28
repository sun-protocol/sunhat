---
description: Run TypeScript/Mocha and native Solidity tests through the Sunhat Hardhat 3 task without a second build.
---

# Test

Use `sunhat test [files...]`. The command selects `sunhat.test.target`, builds it once, and invokes Hardhat runners with `noCompile: true` so tests consume the same target snapshot.

- Use `--grep` or `--grep-exclude` for Mocha filtering.
- Pass a TypeScript test path or native `.t.sol` path to limit files.
- A TRON target requires an explicitly bound TVM network. Never fall back to an EVM simulator.
- Do not install or invoke Forge as part of the Sunhat 2.x test workflow.

Preserve the runner's non-zero exit status and report whether the failure came from compilation, Mocha, native Solidity tests, or network selection.
