---
description: Run comprehensive tests using Foundry (Solidity) and Hardhat (JS/TS)
---

# Sunhat Testing Workflow

I will help you run and debug tests for your TRON smart contracts.

## 1. Foundry (Solidity Testing) - Recommended

Foundry is the preferred testing framework for its speed and solidity-native cheating capabilities.

### Basic Testing
Run all tests:
```bash
forge test
```

### Advanced Filtering
- **Specific Test**: `forge test --match-test testTransfer`
- **Specific Contract**: `forge test --match-contract TokenTest`
- **Specific Path**: `forge test --match-path test/Token.t.sol`

### Debugging & Tracing
- **Logs**: `forge test -vv` (Show logs)
- **Failure Traces**: `forge test -vvv` (Show stack traces for failures)
- **Full Traces**: `forge test -vvvv` (Show all stack traces)
- **Debugger**: `forge script script/Deploy.s.sol --debug`

### Gas Reporting
Generate a gas report for your contracts:
```bash
forge test --gas-report
```

### Mainnet Forking
Test against live chain state (e.g., Nile or Mainnet):
```bash
forge test --fork-url https://nile.trongrid.io/jsonrpc
```

---

## 2. Hardhat (JS/TS Testing)

Use Hardhat for integration tests or when JS/TS scripting is required.

```bash
npx hardhat test
```

- Run specific file: `npx hardhat test test/MyContract.test.ts`
- Run with network: `npx hardhat test --network hardhat` (Default)
