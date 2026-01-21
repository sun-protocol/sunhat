---
description: Deploy contracts to the Tron network using Sunhat
---

# Sunhat Deploy

I will help you deploy your contracts to the Tron network (Mainnet, Nile, Shasta).

## Guardrails

- **CRITICAL**: Ensure `deployTron/` folder exists (Sunhat convention)
- Verify `TRON_RPC_URL` and `PRIVATE_KEY` are in `.env`
- Ensure `network: tron` is configured in `hardhat.config.ts`

## Steps

### 1. Prepare Deployment Script

- Check `deployTron/` for existing scripts
- If creating a new script, use this template:
  ```typescript
  import { DeployFunction } from 'hardhat-deploy/types';
  import { HardhatRuntimeEnvironment } from 'hardhat/types';
  const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();
    await deploy('MyContract', { from: deployer, args: [], log: true });
  };
  export default func;
  func.tags = ['MyContract'];
  ```

### 2. Check Network Status

- Verify RPC connection (optional, via curl or script)
- Check deployer balance (if possible)

### 3. Execute Deployment

Run the deploy command targeting the Tron network:

```bash
npx hardhat deploy --network tron
```

_Optional: Add `--tags [Tag]` to run specific scripts._

### 4. Verify Output

- Check console logs for "deployed at" address
- Note the address for verification
