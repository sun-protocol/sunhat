#!/usr/bin/env node
import fs from 'fs-extra';
import path from 'path';
import { spawn, execSync } from 'child_process';
import colors from 'colors';

const SCAFFOLD = {
  packageJson: (pluginVersion: string, projectName: string) => ({
    name: projectName,
    version: '1.0.0',
    devDependencies: {
      dotenv: '^16.4.7',
      hardhat: '^2.23.0',
      '@nomicfoundation/hardhat-foundry': '^1.1.3',
      '@nomicfoundation/hardhat-toolbox': '^5.0.0',
      '@nomiclabs/hardhat-vyper': '^3.0.8',
      '@sun-protocol/sunhat': `^${pluginVersion}`,
    },
    scripts: {
      start: 'hardhat node',
      compile: 'hardhat compile',
      clean: 'hardhat clean',
      test: 'hardhat test',
      'test-foundry': 'forge test -vvv',
      coverage: 'hardhat coverage',
      audit: 'hardhat audit',
      'vscode-audit': 'hardhat audit --format json',
      deploy: 'hardhat deploy --network tron',
    },
  }),
  gitignore: `dist
node_modules
build
.env
cache
package-lock.json
deployments/
artifacts/
typechain-types/
out/
cache_forge/
lib/
pnpm-lock.yaml
.pnpm-store
*.swp
*.swo
audit-report.json
coverage.json
coverage/
foundry.lock
`,
  env: `# Network Config
TRON_RPC_URL=https://api.trongrid.io/jsonrpc
PRIVATE_KEY=

# API Keys
ETHERSCAN_API_KEY=
TRONSCAN_API_KEY=

# LLM Config
MODEL_NAME=

OPENAI_API_KEY=
OPENAI_ENDPOINT=
OPENAI_DEPLOYMENT=
OPENAI_API_VERSION=

GEMINI_API_KEY=

QWEN_API_KEY=
QWEN_BASE_URL=

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=
`,
  tsconfig: `{
  "compilerOptions": {
    "target": "es2020",
    "module": "commonjs",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["./hardhat.config.ts", "./scripts", "./test", "./deploy"]
}
`,
  contract: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract TronGreeter {
    string public greeting;

    constructor(string memory _greeting) {
        greeting = _greeting;
    }

    function setGreeting(string memory _greeting) public {
        greeting = _greeting;
    }

    function greet() public view returns (string memory) {
        return greeting;
    }
}
`,
  foundryTest: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test, console} from "forge-std/Test.sol";
import {TronGreeter} from "../contracts/TronGreeter.sol";

contract TronGreeterTest is Test {
    TronGreeter public greeter;

    function setUp() public {
        greeter = new TronGreeter("Hello Tron");
    }

    function test_InitialGreeting() public {
        string memory actualGreeting = greeter.greet();
        string memory expectedGreeting = "Hello Tron";

        assertEq(actualGreeting, expectedGreeting, "Initial greeting should match");
    }

    function test_SetGreeting() public {
        string memory newGreeting = "Hola Sun";
        greeter.setGreeting(newGreeting);

        string memory actualGreeting = greeter.greet();

        assertEq(actualGreeting, newGreeting, "Greeting should change after calling setGreeting");
    }
}
`,
  mochaTest: `import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("TronGreeter", function () {
  async function deployGreeterFixture() {
    const initialGreeting = "Hello Tron";
    const TronGreeter = await ethers.getContractFactory("TronGreeter");
    const greeter = await TronGreeter.deploy(initialGreeting);

    return { greeter, initialGreeting };
  }

  it("Should return the new greeting once it's changed", async function () {
    const { greeter, initialGreeting } = await loadFixture(deployGreeterFixture);

    expect(await greeter.greet()).to.equal(initialGreeting);

    const newGreeting = "Hola Sun";
    const tx = await greeter.setGreeting(newGreeting);
    await tx.wait();

    expect(await greeter.greet()).to.equal(newGreeting);
  });

  it("Should set the right greeting on deployment", async function () {
    const { greeter, initialGreeting } = await loadFixture(deployGreeterFixture);
    expect(await greeter.greet()).to.equal(initialGreeting);
  });
});
`,
  deployScript: `import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  await deploy('TronGreeter', {
    from: deployer,
    args: ['Hello Tron!'],
    log: true,
  });
};
export default func;
func.tags = ['TronGreeter'];
`,
  hardhatConfig: `import { HardhatUserConfig } from '@sun-protocol/sunhat';
import '@nomicfoundation/hardhat-toolbox';
import '@nomiclabs/hardhat-vyper';
import '@sun-protocol/sunhat';
import '@nomicfoundation/hardhat-foundry';

import * as dotenv from 'dotenv';
dotenv.config();

const settings = {
  optimizer: {
    enabled: true, // enabled for optimizer
    runs: 999999, // runs time for optimizer run
  },
};

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      { version: '0.8.25', settings }, // current solc version 1
    ],
  },
  vyper: {
    compilers: [
      { version: '0.2.8' }, // current vyper compilers version 1
    ],
  },
  // settings for different networks
  networks: {
    tron: {
      url: process.env.TRON_RPC_URL || 'https://nile.trongrid.io/jsonrpc', // tron rpc url
      tron: true, // enable tron network
      deploy: ['deploy/'], // folder for tron deploy scripts
      accounts: process.env.PRIVATE_KEY ? [ process.env.PRIVATE_KEY ] : [], // account private key for deploy
    },
  },
  tronSolc: {
    enable: true, // enable tron solc compiler
  },
  namedAccounts: {
    deployer: {
      default: 0, // here this will by default take the first account as deployer
    },
  },
  llm: {
    defaultProvider: 'openai',
    // promptTemplate:
    //   'As a world-class smart contract auditor, please perform a detailed security review of the following {language} code from the file "{contractName}". Focus especially on re-entrancy, integer overflows, and access control issues.',
    providers: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.MODEL_NAME || 'gpt-4o',
      },
      // azure_openai: {
      //   apiKey: process.env.OPENAI_API_KEY || '',
      //   endpoint: process.env.OPENAI_ENDPOINT || '',
      //   deploymentName: process.env.OPENAI_DEPLOYMENT || '',
      //   apiVersion: process.env.OPENAI_API_VERSION || '',
      //   model: process.env.MODEL_NAME || 'gpt-4o',
      // },
      // gemini: {
      //   apiKey: process.env.GEMINI_API_KEY || '',
      //   model: process.env.MODEL_NAME || 'gemini-2.5-pro',
      // },
      // qwen: {
      //   apiKey: process.env.QWEN_API_KEY || '',
      //   model: process.env.MODEL_NAME || 'qwen-turbo',
      //   baseURL: process.env.QWEN_BASE_URL || '',
      // },
      // deepseek: {
      //   apiKey: process.env.DEEPSEEK_API_KEY || '',
      //   model: process.env.MODEL_NAME || 'deepseek-coder',
      //   baseURL: process.env.DEEPSEEK_BASE_URL || '',
      // },
    },
  },
};

export default config;
`,
};

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'init') {
    await handleInit(args);
    return;
  }

  await handleProxy(args);
}

async function handleInit(args: string[]) {
  const targetName = args[1] || '.';
  const targetDir = path.resolve(process.cwd(), targetName);
  const isCurrentDir = targetName === '.';

  console.log(
    colors.cyan(
      `\n☀️  Initializing SunHat Project in ${
        isCurrentDir ? 'current directory' : targetDir
      }...\n`
    )
  );

  if (!isCurrentDir && (await fs.pathExists(targetDir))) {
    const files = await fs.readdir(targetDir);
    if (files.length > 0) {
      console.error(
        colors.red(`Error: Directory '${targetName}' is not empty.`)
      );
      process.exit(1);
    }
  }

  await fs.ensureDir(targetDir);

  const myPackageJsonPath = path.resolve(__dirname, '../../package.json');
  const myPackageJson = await fs
    .readJSON(myPackageJsonPath)
    .catch(() => ({ version: 'latest' }));

  // 1. Create Directories
  await fs.ensureDir(path.join(targetDir, 'contracts'));
  await fs.ensureDir(path.join(targetDir, 'deploy'));
  await fs.ensureDir(path.join(targetDir, 'scripts'));
  await fs.ensureDir(path.join(targetDir, 'test'));

  // 2. Create Files
  await fs.outputFile(path.join(targetDir, '.env'), SCAFFOLD.env);
  await fs.outputFile(path.join(targetDir, '.gitignore'), SCAFFOLD.gitignore);
  await fs.outputFile(path.join(targetDir, 'tsconfig.json'), SCAFFOLD.tsconfig);
  await fs.outputFile(
    path.join(targetDir, 'contracts/TronGreeter.sol'),
    SCAFFOLD.contract
  );
  await fs.outputFile(
    path.join(targetDir, 'test/TronGreeter.t.sol'),
    SCAFFOLD.foundryTest
  );
  await fs.outputFile(
    path.join(targetDir, 'test/TronGreeter.test.ts'),
    SCAFFOLD.mochaTest
  );
  await fs.outputFile(
    path.join(targetDir, 'deploy/01_deploy_greeter.ts'),
    SCAFFOLD.deployScript
  );
  await fs.outputFile(
    path.join(targetDir, 'hardhat.config.ts'),
    SCAFFOLD.hardhatConfig
  );

  const pkgJsonData = SCAFFOLD.packageJson(
    myPackageJson.version,
    path.basename(targetDir)
  );
  await fs.writeJSON(path.join(targetDir, 'package.json'), pkgJsonData, {
    spaces: 2,
  });

  console.log('Installing dependencies...');

  // install dependencies
  const installChild = spawn('npm', ['install'], {
    cwd: targetDir,
    stdio: 'inherit',
    shell: true,
  });

  installChild.on('close', (code) => {
    if (code === 0) {
      try {
        console.log('Initializing git repository...');
        execSync('git init', { cwd: targetDir, stdio: 'ignore' });
        execSync('git add .', { cwd: targetDir, stdio: 'ignore' });
        execSync('git commit -m "Initial sunhat project"', {
          cwd: targetDir,
          stdio: 'ignore',
        });
        console.log(colors.green('✅ Git repository initialized.'));
      } catch (e) {
        console.warn(
          colors.yellow(
            "⚠️  Failed to initialize git repository. You may need to run 'git init' manually."
          )
        );
      }
      try {
        console.log('Setting up Foundry...');
        execSync('npx hardhat init-foundry', {
          cwd: targetDir,
          stdio: 'inherit',
        });
        console.log(colors.green('✅ Foundry initialized.'));
      } catch (e) {
        console.warn(
          colors.yellow(
            "⚠️  Failed to initialize git repository. You may need to run 'npx hardhat init-foundry' manually."
          )
        );
      }
      console.log(colors.green(`\n✅ Project ready!`));
      if (!isCurrentDir) {
        console.log(`\nYou may want to: ${colors.yellow('cd ${targetName}')}`);
      }
    } else {
      console.error(colors.red('\n❌ Dependencies installation failed.'));
    }
  });
}

async function handleProxy(args: string[]) {
  const localHardhatBin = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    'hardhat'
  );

  let executable = localHardhatBin;

  if (
    !fs.existsSync(localHardhatBin) &&
    !fs.existsSync(localHardhatBin + '.cmd')
  ) {
    console.error(
      colors.yellow(`\n⚠️  Could not find local hardhat installation.`)
    );
    console.error(
      `Please run inside a project directory or run '${colors.cyan(
        'sunhat init'
      )}' to create one.\n`
    );
    process.exit(1);
  }

  if (process.platform === 'win32') {
    executable += '.cmd';
  }

  const child = spawn(executable, args, {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => {
    child.kill('SIGINT');
  });
  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
