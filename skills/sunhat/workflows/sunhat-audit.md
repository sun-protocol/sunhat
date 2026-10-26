---
description: Perform a manual "White Hat" security audit and verify with Foundry
---

# Agentic Security Audit (White Hat)

I will act as a generic **White Hat Security Researcher** to analyze your smart contracts, identify vulnerabilities, verify them with tests, and report findings.

## Phase 1: Deep Analysis

I will read the contract code line-by-line, looking for common and complex vulnerabilities, including but not limited to:
- Re-entrancy
- Access Control failures
- Arithmetic Over/Underflows
- Logic errors
- **Arbitrage via Special Request Data**: Constructing specific input parameters or calldata to identify profitable logical inconsistencies.
- Tron-specific issues (e.g., energy consumption, bandwidth)

## Phase 2: Verification (Proof of Concept)

For every potential vulnerability identified, I will **create a reproduction test case** using Foundry.

1.  **Create Test File**: Create a new test file (e.g., `test/Audit_Exploit.t.sol`).
2.  **Write Exploit**: Write a Solidity test that attempts to exploit the vulnerability.
3.  **Run Test**: Execute `forge test --match-test <ExploitName>`.
4.  **Confirm**: Ensure the test passes (confirming the exploit works) or fails (if the code is safe).

```solidity
// Example PoC Structure
function testExploit() public {
    vm.startPrank(attacker);
    // ... perform attack ...
    assertGt(attacker.balance, initialBalance);
}
```

## Phase 3: Reporting

I will generate a **Bug Report** for each confirmed issue containing:
- **Title**: Concise name of the vulnerability.
- **Severity**: Critical, High, Medium, Low, Info.
- **Description**: Detailed explanation of the logic flaw.
- **Impact**: What happens if exploited (funds lost, system frozen, etc.).
- **Proof of Concept**: The Foundry test code used to verify it.
- **Recommendation**: How to fix the code.

## Phase 4: Remediation

Once the report is reviewed, I can assist in applying the fixes and running the PoC again to verify the patch (the test should now fail to exploit).
