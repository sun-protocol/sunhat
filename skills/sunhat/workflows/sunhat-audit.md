---
description: Audit Solidity or Vyper contracts and verify concrete findings with the project's Hardhat 3 test stack.
---

# Audit

Read every security-critical contract directly, including inherited storage and linked libraries. Trace asset movement, authority, external calls, price inputs, rounding direction, upgrade boundaries, and chain-specific semantics before assigning severity.

For each plausible finding:

1. Cite the exact file and line and describe the violated invariant.
2. Establish a reachable source-to-sink path and attacker prerequisites.
3. Add the smallest deterministic TypeScript or native Solidity Hardhat 3 regression test that proves impact.
4. Run it with `sunhat test <file>` and preserve the actual result.
5. Distinguish confirmed vulnerabilities from hardening suggestions and false positives.

Do not use pool balances as a price oracle, timestamp-derived randomness for security decisions, or direct raw broadcasts to demonstrate an exploit. Never test against an external network without explicit authorization.
