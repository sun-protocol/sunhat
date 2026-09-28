---
description: Compile configured Solidity, tron-solc, and Vyper targets through Sunhat's isolated build coordinator.
---

# Compile

1. Read `hardhat.config.ts` and identify the selected target, compiler kinds, exact versions, source roots, overrides, and network binding.
2. For custom tron-solc or `vyper-json`, verify that `path` is absolute and the configured SHA-256 is present. Do not display secrets while resolving configuration variables.
3. Run one of:

   ```bash
   sunhat compile
   sunhat compile --target <target>
   sunhat compile --network <network>
   sunhat compile --all
   ```

4. Verify the emitted JSON includes a build ID, target, cache result, and immutable snapshot directory under `build-snapshots/<target>/<buildId>`.
5. On failure, use the structured diagnostic. Do not deploy stale artifacts or fall back to another compiler.

`--target` and `--network` must select the same target when combined. `--all` is mutually exclusive with both selectors.

Use `sunhat clean` to remove only `artifacts/sunhat` and `cache/sunhat`. Confirm that `build-snapshots/`, `deployments/`, and `verification/` remain intact; these contain recovery and reproducibility evidence, not disposable build cache.
