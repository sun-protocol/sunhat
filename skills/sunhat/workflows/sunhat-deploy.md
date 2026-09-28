---
description: Deploy through Sunhat's recoverable state machine or restore a saved verification archive.
---

# Deploy and recover

Deployment scripts live under `deploy/`, use ESM default exports, and receive `SunhatDeploymentContext`. Sunhat sorts scripts by normalized path and rejects symbolic links or paths outside the project.

Before an external broadcast, inspect configuration and report:

- network and verified chain identity;
- deployer address without exposing its private key;
- bound target and selected scripts;
- native value and unit;
- exact command.

Obtain explicit user confirmation, then run:

```bash
sunhat deploy --network <network>
```

After success, verify the returned transaction ID, address, runtime match status, and `verification/<networkKey>/verfication-<address>` directory. A complete archive contains source inputs, artifacts, build info, deployment data, receipt, queried runtime code, and a hashed manifest.

If broadcast outcome or archive creation is incomplete, do not rerun deploy. Recover the saved attempt with:

```bash
sunhat verification sync --network <network> --tx <transactionId>
```

The 2.0 alpha task currently permits EVM deployment/sync only. TRON broadcast remains blocked until its TVM execution and resource-accounting matrix passes.
