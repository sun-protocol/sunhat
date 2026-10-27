---
description: Initialize a new Sunhat project for Tron smart contract development
---

# Sunhat Init

I will help you scaffold a new project using the Sunhat toolkit.

## Guardrails

- Check if the current directory is empty or if a new directory name is provided
- Ensure Node.js (v18+) is installed
- Do not run if `hardhat.config.ts` already exists in the current directory (unless forcing)

## Steps

### 1. Verify Environment

- Check Node.js version: `node --version`
- Check if `sunhat` is installed globally: `npm list -g @sun-protocol/sunhat` (optional, can use npx)

### 2. Determine Project Name

- Ask the user for a project name (default to current directory if empty)

### 3. Initialize Project

Run the initialization command:

```bash
sunhat init [project-name]
```

_Note: If `sunhat` is not in PATH, use `npx @sun-protocol/sunhat init [project-name]`_

### 4. Verify Structure

After initialization, verify that the following exist:

- `contracts/`
- `test/`
- `deployTron/` (or `deploy/`)
- `hardhat.config.ts`

### 5. Post-Init Setup

- Remind user to fill in `.env` with `PRIVATE_KEY` and `TRON_RPC_URL`
- Suggest running `npm install` if it wasn't run automatically
