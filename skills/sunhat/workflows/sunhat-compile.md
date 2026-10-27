---
description: Compile Solidity and Vyper contracts using Sunhat (Hardhat)
---

# Sunhat Compile

I will help you compile your smart contracts, ensuring Tron compatibility.

## Guardrails

- Ensure `hardhat.config.ts` exists
- Check if `tronSolc` is enabled in config if using Tron-specific features

## Steps

### 1. Check Configuration

- Read `hardhat.config.ts`
- Verify `networks.tron` exists and `tron: true` is set (good practice)
- Verify `tronSolc` settings if applicable

### 2. Run Compile

Execute the compile task:

```bash
npx hardhat compile
```

### 3. Check Artifacts

- Verify artifacts were generated in `artifacts/`
- For Tron-specific builds, check `extendedArtifactsTron/`

### 4. Handle Errors

If compilation fails:

- Check for Solidity version mismatches
- Suggest installing `tronweb` if missing
- Check for "Stack too deep" or similar common Solidity errors
