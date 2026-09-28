import path from 'path';
import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'fs/promises';
import { SunhatCliError } from './errors.js';

const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export interface ProjectTemplateOptions {
  readonly projectName: string;
  readonly sunhatVersion: string;
}

export interface ProjectTemplate {
  readonly files: Readonly<Record<string, string>>;
}

export function createProjectTemplate(
  options: ProjectTemplateOptions
): ProjectTemplate {
  if (!PROJECT_NAME_PATTERN.test(options.projectName)) {
    throw new SunhatCliError(
      'INVALID_PROJECT_NAME',
      `project name "${options.projectName}" must be lowercase and npm-safe`
    );
  }
  if (!/^2\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(options.sunhatVersion)) {
    throw new SunhatCliError(
      'INCOMPATIBLE_SUNHAT',
      `template requires an exact Sunhat 2.x version, received "${options.sunhatVersion}"`
    );
  }

  const packageJson = {
    name: options.projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      clean: 'sunhat clean',
      compile: 'sunhat compile',
      deploy: 'sunhat deploy --network nile',
      test: 'sunhat test',
    },
    devDependencies: {
      '@nomicfoundation/hardhat-toolbox-mocha-ethers': '3.0.7',
      '@sun-protocol/sunhat': options.sunhatVersion,
      '@types/chai': '5.2.3',
      '@types/mocha': '10.0.10',
      '@types/node': '24.5.2',
      chai: '6.2.2',
      ethers: '6.17.0',
      hardhat: '3.15.0',
      mocha: '11.7.4',
      typescript: '5.9.3',
    },
    overrides: {
      diff: '8.0.3',
      'serialize-javascript': '7.0.5',
    },
  };

  const files: Record<string, string> = {
    '.env.example': `TRON_RPC_URL=https://nile.trongrid.io/jsonrpc
TRON_PRIVATE_KEY=
`,
    '.gitignore': `node_modules/
artifacts/
cache/
deployments/
verification/
.env
`,
    'contracts/Counter.sol': `// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

/// @title Minimal Sunhat counter
contract Counter {
    uint256 public value;

    event ValueIncremented(uint256 indexed previousValue, uint256 indexed newValue);

    /// @notice Increments the stored value by one.
    function increment() external {
        uint256 previousValue = value;
        uint256 newValue = previousValue + 1;
        value = newValue;
        emit ValueIncremented(previousValue, newValue);
    }
}
`,
    'hardhat.config.ts': `import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import sunhat from "@sun-protocol/sunhat";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers, sunhat],
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
      sunhat: { target: "evm" },
    },
    nile: {
      type: "http",
      chainType: "generic",
      url: configVariable("TRON_RPC_URL"),
      accounts: [configVariable("TRON_PRIVATE_KEY")],
      sunhat: { target: "tron" },
    },
  },
  sunhat: {
    compilation: {
      defaultTarget: "evm",
      targets: {
        evm: {
          chain: "evm",
          sources: ["contracts"],
          compilers: [
            {
              id: "evm-solidity",
              kind: "solc",
              version: "0.8.25",
              settings: { optimizer: { enabled: true, runs: 200 } },
            },
          ],
        },
        tron: {
          chain: "tron",
          sources: ["contracts"],
          compilers: [
            {
              id: "tron-solidity",
              kind: "tron-solc",
              version: "0.8.25",
              settings: { optimizer: { enabled: true, runs: 200 } },
            },
          ],
        },
      },
    },
    test: { target: "evm" },
    verification: {
      outputDir: "verification",
      sourceMode: "multi-file",
      autoExport: true,
    },
  },
});
`,
    'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
    'test/Counter.ts': `import assert from "node:assert/strict";
import { network } from "hardhat";

describe("Counter", function () {
  it("increments through an explicit Hardhat 3 connection", async function () {
    const connection = await network.create();
    try {
      const counter = await connection.ethers.deployContract("Counter");
      await counter.waitForDeployment();
      const transaction = await counter.increment();
      await transaction.wait();
      assert.equal(await counter.value(), 1n);
    } finally {
      await connection.close();
    }
  });
});
`,
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          lib: ['ES2023'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          strict: true,
          target: 'ES2022',
          types: ['node', 'mocha'],
        },
        include: ['hardhat.config.ts', 'test/**/*.ts'],
      },
      null,
      2
    )}\n`,
  };
  return Object.freeze({ files: Object.freeze(files) });
}

export async function writeProjectTemplate(
  destination: string,
  template: ProjectTemplate
): Promise<void> {
  const target = path.resolve(destination);
  if (target === path.parse(target).root) {
    throw new SunhatCliError(
      'TEMPLATE_WRITE_FAILED',
      'refusing to initialize a project at the filesystem root'
    );
  }
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(parent, '.sunhat-init-'));
  try {
    for (const [relativePath, content] of Object.entries(template.files)) {
      const outputPath = path.resolve(temporaryDirectory, relativePath);
      if (!isInside(temporaryDirectory, outputPath)) {
        throw new SunhatCliError(
          'TEMPLATE_WRITE_FAILED',
          `template path escapes the project directory: ${relativePath}`
        );
      }
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content, { encoding: 'utf8', flag: 'wx' });
    }
    if (await pathExists(target)) {
      const entries = await readdir(target);
      if (entries.length !== 0) {
        throw new SunhatCliError(
          'PROJECT_EXISTS',
          `destination is not empty: ${target}`
        );
      }
      await rmdir(target);
    }
    await rename(temporaryDirectory, target);
  } catch (error) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    if (error instanceof SunhatCliError) {
      throw error;
    }
    throw new SunhatCliError(
      'TEMPLATE_WRITE_FAILED',
      `failed to initialize ${target}: ${formatError(error)}`
    );
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await readdir(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
