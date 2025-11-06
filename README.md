# Sunhat
[![CI Status](https://github.com/sun-protocol/sunhat/actions/workflows/linux-test.yml/badge.svg)](https://github.com/sun-protocol/sunhat/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**An All-in-One Toolkit for the Complete TRON Smart Contract Lifecycle**

Sunhat is a comprehensive [Hardhat](https://hardhat.org) plugin designed to provide a seamless, end-to-end development experience on [TRON](https://tron.network/). It manages every stage of your project—from writing code in multiple languages to deploying with confidence—all within a single, unified workflow.

## What is it for?

This [hardhat](https://hardhat.org) plugin adds a mechanism to deploy contracts to any network, Especially to [Tron](https://tron.network/) , keeping track of them and replicating the same environment for testing.

### A Closed-Loop Lifecycle: Develop, Test, Deploy

Sunhat creates a complete, closed-loop process, ensuring consistency and reliability from the first line of code to the final on-chain transaction.

*  **DEVELOP: Flexible & Powerful Compilation**
   *   Write your smart contracts in the language you prefer with multi-language support for **Solidity** and **Vyper**.
   *   Compile your code for maximum compatibility and performance using multiple compiler versions, including standard **solc** and the TRON-specific **tron-solc**.

*  **TEST: Robust & Automated Validation**
   *   Leverage automated, cross-framework testing. Sunhat integrates seamlessly with both **Hardhat**'s built-in testing environment and the high-speed **Foundry** toolkit.
   *   Write clearer, more maintainable tests using named accounts instead of hardcoded addresses.

*  **DEPLOY: Confident & Trackable**
   *   Deploy your contracts reliably to any TRON network (Mainnet, Shasta, etc.). The plugin tracks all deployments, allowing you to manage and upgrade your contracts with ease.


### Core Features at a Glance

*   **Unified Development Environment**: Supports multiple compilers (**solc**, **tron-solc**) and languages (**Solidity**, **Vyper**), giving your team the flexibility to use the best tools for the job.

*   **Cross-Framework Automated Testing**: Natively supports test suites written for both **Hardhat** and **Foundry**, eliminating the need to choose between frameworks.

*   **Deterministic Deployments**: Reliably deploy contracts and track their history. This allows you to replicate the exact same on-chain state for testing, staging, or disaster recovery.

*   **Named Accounts**: Replace ambiguous addresses (`accounts[0]`) with human-readable names (`deployer`, `tokenOwner`). This makes scripts and tests cleaner and simplifies multi-network configuration.

*   **TRON-Specific Network Data**: Gain access to crucial network-specific parameters directly within your testing and deployment scripts, enabling more accurate pre-deployment simulations.

---

## QuickStart

This guide walks you through setting up sunhat in a new project from scratch.
> You can get a complete demo [here](https://github.com/sun-protocol/sunhat-demo)

---

### Installation

This guide walks you through installing sunhat from scratch.

#### Prerequisites

*   **Node.js**: Version `22.14.0` or higher.
    > [Download Node.js](https://nodejs.org/en/download)

#### Install Sunhat

You can install Sunhat by executing the following command:

```bash
npm install -g @sun-protocol/sunhat
```

#### Install Optional Extensions

For Vyper compiler support:
> [Vyper Installation Guide](https://docs.vyperlang.org/en/stable/installing-vyper.html)
```bash
pip install vyper==0.2.8
```

For Foundry test support:
> [Foundry Installation Guide](https://book.getfoundry.sh/getting-started/installation)

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
# Set Foundry to the nightly channel
foundryup --install nightly
```

---

### Step 1: Configure Hardhat

Add sunhat to your hardhat.config.ts:

```ts
import { HardhatUserConfig } from '@sun-protocol/sunhat';

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.8.23',
        optimizer: {
          enabled: true, // enabled for optimizer
          runs: 999999, // runs time for optimizer run
        },
      },
    ],
  },
  // settings for different networks
  networks: {
    tron: {
      url: 'https://nile.trongrid.io/jsonrpc', // tron mainnet rpc url
      tron: true, // enable tron network
      deploy: ['deployTron/'], // folder for tron deploy scripts
      accounts: [`${process.env.PRIVATE_KEY}`], // account private key for deploy
    },
  },
};

export default config;
```

---

### Step 2: Create Your First Contract

Create a simple contract in `contracts/Lock.sol`:

```solidity
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

contract Lock {
    uint public unlockTime;
    address payable public owner;

    event Withdrawal(uint amount, uint when);

    constructor(uint _unlockTime) payable {
        require(_unlockTime > block.timestamp, "Unlock time should be in the future");
        unlockTime = _unlockTime;
        owner = payable(msg.sender);
    }

    function withdraw() public {
        require(block.timestamp >= unlockTime, "You can't withdraw yet");
        require(msg.sender == owner, "You aren't the owner");
        emit Withdrawal(address(this).balance, block.timestamp);
        owner.transfer(address(this).balance);
    }
}
```

---

### Step 3: Create Deploy Directory

Create a `deployTron/` directory in your project root.

---

### Step 4: Write Your First Deploy Script

Create `deployTron/1.ts`:

```ts
module.exports = async ({
  getNamedAccounts,
  deployments,
  getChainId,
  getUnnamedAccounts,
}) => {
  const {deploy} = deployments;
  const {deployer} = await getNamedAccounts();

  // the following will only deploy "GenericMetaTxProcessor" if the contract was never deployed or if the code changed since last deployment
  const res = await deploy('Lock', {
    from: deployer,
    gasLimit: 4000000,
    args: [1893456000],
    tags: 'lumi',
  });
  console.log(res)
};

module.exports.tags = ['lumi'];
```

---

### Step 5: Compile and Deploy

Compile your contracts:

```bash
npx hardhat compile
```

Deploy to tron network:

```bash
npx hardhat --network tron deploy --tags lumi
```

---

### Step 6: Verify Deployment

Check the `deployments/` directory for your deployment files. You should see:
```
├── deployments
│   └── tron
│       └── Lock.json
```

---

## Development
To dive deeper into advanced topics of the sunhat project lifecycle, please see the [Documentation](https://docs-hat.sun.io/) for guides and reference.

---

## How to Contribute

We welcome contributions from everyone! Contributions to `sunhat` are released under the terms of the [MIT License](https://github.com/sun-protocol/sunhat/blob/main/LICENSE). By submitting a pull request, you agree to license your contribution under this license.

To contribute, see [CONTRIBUTE.md](https://github.com/sun-protocol/sunhat/blob/main/CONTRIBUTE.md)
