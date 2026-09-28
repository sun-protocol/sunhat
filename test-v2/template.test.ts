import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, it } from 'node:test';
import {
  createProjectTemplate,
  SunhatCliError,
  writeProjectTemplate,
} from '../src/v2/cli/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe('Sunhat 2.x project template', () => {
  it('creates an ESM Hardhat 3 project without Forge or legacy Vyper plugins', () => {
    const template = createProjectTemplate({
      projectName: 'sunhat-project',
      sunhatVersion: '2.0.0-rc.1',
    });
    const packageJson = JSON.parse(template.files['package.json']);
    const config = template.files['hardhat.config.ts'];
    const combined = Object.values(template.files).join('\n');

    assert.equal(packageJson.type, 'module');
    assert.equal(packageJson.devDependencies.hardhat, '3.15.0');
    assert.equal(packageJson.devDependencies['@sun-protocol/sunhat'], '2.0.0-rc.1');
    assert.deepEqual(packageJson.scripts, {
      clean: 'sunhat clean',
      compile: 'sunhat compile',
      deploy: 'sunhat deploy --network nile',
      test: 'sunhat test',
    });
    assert.match(config, /plugins: \[hardhatToolboxMochaEthers, sunhat\]/);
    assert.match(template.files['test/Counter.ts'], /network\.create\(\)/);
    assert.doesNotMatch(template.files['contracts/Counter.sol'], /unchecked/);
    assert.doesNotMatch(combined, /forge|foundry|@nomiclabs\/hardhat-vyper/i);
    assert.doesNotMatch(combined, /PRIVATE_KEY=[0-9a-f]/i);
  });

  it('writes the complete template through a temporary directory', async () => {
    const parent = await temporaryDirectory();
    const destination = path.join(parent, 'generated-project');
    const template = createProjectTemplate({
      projectName: 'generated-project',
      sunhatVersion: '2.0.0',
    });

    await writeProjectTemplate(destination, template);

    const packageJson = JSON.parse(
      await readFile(path.join(destination, 'package.json'), 'utf8')
    );
    assert.equal(packageJson.name, 'generated-project');
    assert.match(
      await readFile(path.join(destination, 'contracts', 'Counter.sol'), 'utf8'),
      /pragma solidity 0\.8\.25;/
    );
  });

  it('supports an existing empty destination but refuses non-empty directories', async () => {
    const parent = await temporaryDirectory();
    const emptyDestination = path.join(parent, 'empty');
    await mkdir(emptyDestination);
    const template = createProjectTemplate({
      projectName: 'empty',
      sunhatVersion: '2.0.0',
    });
    await writeProjectTemplate(emptyDestination, template);

    await assert.rejects(
      () => writeProjectTemplate(emptyDestination, template),
      (error: unknown) => {
        assert.ok(error instanceof SunhatCliError);
        assert.equal(error.code, 'PROJECT_EXISTS');
        return true;
      }
    );
  });

  it('rejects unsafe project names and non-2.x template versions', () => {
    assert.throws(
      () =>
        createProjectTemplate({
          projectName: '../escape',
          sunhatVersion: '2.0.0',
        }),
      /npm-safe/
    );
    assert.throws(
      () =>
        createProjectTemplate({
          projectName: 'project',
          sunhatVersion: '^2.0.0',
        }),
      /exact Sunhat 2.x version/
    );
  });

  it('refuses the filesystem root as an initialization target', async () => {
    const template = createProjectTemplate({
      projectName: 'project',
      sunhatVersion: '2.0.0',
    });
    await assert.rejects(
      () => writeProjectTemplate(path.parse(process.cwd()).root, template),
      /filesystem root/
    );
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sunhat-template-'));
  temporaryDirectories.push(directory);
  return directory;
}
