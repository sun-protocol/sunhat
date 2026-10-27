import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../', import.meta.url));

function runtime(t) {
  const temporary = realpathSync(
    mkdtempSync(resolve(tmpdir(), 'sunhat-assets-')),
  );
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const packageRoot = resolve(
    temporary,
    process.platform === 'win32' ? 'package with spaces' : 'package "quoted"',
  );
  mkdirSync(packageRoot);
  for (const name of ['bin', 'dist', 'templates', 'package.json']) {
    cpSync(resolve(repository, name), resolve(packageRoot, name), {
      recursive: true,
    });
  }
  return { temporary, packageRoot, cli: resolve(packageRoot, 'bin/sunhat.js') };
}

function json(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(fixture, args) {
  return spawnSync(process.execPath, [fixture.cli, 'init', ...args], {
    cwd: fixture.temporary,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

for (const framework of ['hardhat', 'foundry']) {
  for (const target of ['evm', 'tron']) {
    test(`${framework}/${target} initialization follows template changes without rebuilding`, (t) => {
      const fixture = runtime(t);
      const source = resolve(fixture.packageRoot, 'templates', framework);
      const variant = resolve(source, target);
      const project = resolve(
        fixture.temporary,
        process.platform === 'win32'
          ? 'project with spaces'
          : 'project "quoted"',
      );
      const manifest = JSON.parse(
        readFileSync(resolve(variant, 'package.json')),
      );
      manifest.devDependencies['@types/node'] = '22.10.2';
      manifest.scripts.typecheck = 'tsc --noEmit';
      json(resolve(variant, 'package.json'), manifest);

      const native =
        framework === 'hardhat' ? 'hardhat.config.ts' : 'foundry.toml';
      const originalConfig = readFileSync(resolve(variant, native), 'utf8');
      const customizedConfig =
        framework === 'hardhat'
          ? originalConfig.replaceAll('0.8.26', '0.8.25')
          : `${originalConfig}optimizer = true\n`;
      assert.notEqual(customizedConfig, originalConfig);
      writeFileSync(resolve(variant, native), customizedConfig);
      const binding = readFileSync(
        resolve(variant, 'sunhat.toml'),
        'utf8',
      ).replace(/\n$/u, ' # template-owned binding\n');
      writeFileSync(resolve(variant, 'sunhat.toml'), binding);
      const readme = `# Customized ${framework}/${target} template\n`;
      writeFileSync(resolve(variant, 'README.md'), readme);
      json(resolve(source, 'common/config/shared.json'), { enabled: true });
      json(resolve(source, 'common/config/runtime.json'), { layer: 'common' });
      json(resolve(variant, 'config/runtime.json'), {
        layer: target,
        name: '{{projectName}}',
      });

      const result = run(fixture, [
        '--framework',
        framework,
        '--target',
        target,
        project,
      ]);
      assert.equal(
        result.status,
        0,
        result.stderr || String(result.error ?? ''),
      );
      const generated = JSON.parse(
        readFileSync(resolve(project, 'package.json')),
      );
      assert.equal(generated.name, basename(project));
      assert.equal(
        generated.devDependencies.sunhat,
        `file:${fixture.packageRoot}`,
      );
      assert.equal(generated.devDependencies['@types/node'], '22.10.2');
      assert.equal(generated.scripts.typecheck, 'tsc --noEmit');
      assert.equal(
        readFileSync(resolve(project, native), 'utf8'),
        customizedConfig,
      );
      assert.equal(
        readFileSync(resolve(project, 'sunhat.toml'), 'utf8'),
        binding,
      );
      assert.equal(readFileSync(resolve(project, 'README.md'), 'utf8'), readme);
      assert.deepEqual(
        JSON.parse(readFileSync(resolve(project, 'config/shared.json'))),
        { enabled: true },
      );
      assert.deepEqual(
        JSON.parse(readFileSync(resolve(project, 'config/runtime.json'))),
        {
          layer: target,
          name: basename(project),
        },
      );
    });
  }
}

test('new template files participate in conflict checks before any project file is written', (t) => {
  const fixture = runtime(t);
  json(
    resolve(fixture.packageRoot, 'templates/foundry/common/config/custom.json'),
    { enabled: true },
  );
  const project = resolve(fixture.temporary, 'existing project');
  const owned = resolve(project, 'config/custom.json');
  mkdirSync(dirname(owned), { recursive: true });
  writeFileSync(owned, 'user-owned content');
  const result = run(fixture, [project]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /refusing to overwrite existing file/u);
  assert.equal(readFileSync(owned, 'utf8'), 'user-owned content');
  for (const name of ['package.json', 'sunhat.toml', 'src/Counter.sol']) {
    assert.equal(existsSync(resolve(project, name)), false);
  }
});

test('adoption reads the template binding without copying the remaining scaffold', (t) => {
  const fixture = runtime(t);
  const project = resolve(fixture.temporary, 'adopted project');
  const config = "export default { solidity: '0.8.26' };\n";
  json(resolve(project, 'package.json'), {
    name: 'existing-project',
    private: true,
  });
  writeFileSync(resolve(project, 'hardhat.config.ts'), config);
  const manifest = readFileSync(resolve(project, 'package.json'));
  const bindingPath = resolve(
    fixture.packageRoot,
    'templates/hardhat/evm/sunhat.toml',
  );
  const binding = readFileSync(bindingPath, 'utf8').replace(
    /\n$/u,
    ' # adopted template\n',
  );
  writeFileSync(bindingPath, binding);
  const result = run(fixture, [
    '--framework',
    'hardhat',
    '--target',
    'evm',
    '--adopt',
    project,
  ]);
  assert.equal(result.status, 0, result.stderr || String(result.error ?? ''));
  assert.equal(readFileSync(resolve(project, 'sunhat.toml'), 'utf8'), binding);
  assert.equal(
    readFileSync(resolve(project, 'hardhat.config.ts'), 'utf8'),
    config,
  );
  assert.deepEqual(readFileSync(resolve(project, 'package.json')), manifest);
  for (const name of ['README.md', 'contracts', 'test', 'tsconfig.json']) {
    assert.equal(existsSync(resolve(project, name)), false);
  }
});
