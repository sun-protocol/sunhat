---
description: Initialize a pinned Hardhat 3 ESM project with the project-local Sunhat runtime.
---

# Initialize

1. Confirm Node.js is at least `22.13.0` and the destination is empty or absent.
2. Run `sunhat init <directory>`. Use `--no-install` only when dependency installation is intentionally deferred.
3. Verify the generated project has `"type": "module"`, exact dependency versions, `hardhat.config.ts`, `contracts/`, and `test/`.
4. Keep credentials in environment variables. Do not print private keys or write them into generated config.

The template uses Hardhat 3 Mocha and native Solidity tests. It does not install Forge or a legacy Hardhat Vyper plugin.
