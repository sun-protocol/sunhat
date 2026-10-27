import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { platformKey, releaseFor } from '../dist/toolchain/releases.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const cli = resolve(repository, 'bin/sunhat.js');
const loader = new URL(
  './fixtures/toolchain-install-loader.js',
  import.meta.url,
).href;
const download = new URL(
  './fixtures/toolchain-install-download.js',
  import.meta.url,
).href;
const faults = new URL(
  './fixtures/toolchain-install-faults.js',
  import.meta.url,
).href;
const tools = ['forge', 'cast', 'anvil', 'chisel'];

for (const [name, modify] of [
  [
    'target mismatch',
    (config) => {
      config.target = 'tron';
    },
  ],
  [
    'archive path traversal',
    (config) => {
      config.platforms[platformKey()].archive = '../tools.tar.gz';
    },
  ],
  [
    'binary path traversal',
    (config) => {
      config.platforms[platformKey()].tools.forge = '../forge';
    },
  ],
  [
    'invalid checksum',
    (config) => {
      config.platforms[platformKey()].sha256 = 'not-a-sha256';
    },
  ],
]) {
  test(`toolchain configuration rejects ${name} before installation`, (t) => {
    const root = mkdtempSync(resolve(tmpdir(), 'sunhat-toolchain-config-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const config = JSON.parse(
      readFileSync(
        resolve(repository, 'templates/foundry/evm/foundry-toolchain.json'),
      ),
    );
    modify(config);
    writeFileSync(
      resolve(root, 'foundry-toolchain.json'),
      JSON.stringify(config),
    );
    assert.throws(
      () => releaseFor('evm', root),
      (error) => {
        assert.equal(error.exitCode, 3);
        assert.match(error.message, /configuration/u);
        return true;
      },
    );
  });
}

function releaseOn(target, platform, arch) {
  const platformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    'platform',
  );
  const archDescriptor = Object.getOwnPropertyDescriptor(process, 'arch');
  try {
    Object.defineProperty(process, 'platform', { value: platform });
    Object.defineProperty(process, 'arch', { value: arch });
    return releaseFor(target);
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor);
    Object.defineProperty(process, 'arch', archDescriptor);
  }
}

function writeArchive(fixture, { label = 'fixture', missingTool } = {}) {
  const { target, source, archive } = fixture;
  const windows = process.platform === 'win32';
  rmSync(source, { recursive: true, force: true });
  mkdirSync(source);
  rmSync(archive, { force: true });
  fixture.contents = Object.fromEntries(
    tools
      .filter((tool) => tool !== missingTool)
      .map((tool) => [
        `${tool}${target === 'tron' ? '-tron' : ''}${windows ? '.exe' : ''}`,
        Buffer.from(`${process.platform} ${target} ${tool} ${label}\n`),
      ]),
  );
  for (const [filename, bytes] of Object.entries(fixture.contents)) {
    writeFileSync(resolve(source, filename), bytes);
  }
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  const files = Object.keys(fixture.contents)
    .map((filename) => literal(resolve(source, filename)))
    .join(', ');
  const compressed = windows
    ? spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath @(${files}) -DestinationPath ${literal(archive)}`,
        ],
        { encoding: 'utf8', timeout: 30_000 },
      )
    : spawnSync(
        'tar',
        ['-czf', archive, '-C', source, ...Object.keys(fixture.contents)],
        { encoding: 'utf8', timeout: 30_000 },
      );
  assert.equal(
    compressed.status,
    0,
    compressed.stderr || String(compressed.error ?? ''),
  );
}

function installFixture(t, target, directory = tmpdir()) {
  const temporary = realpathSync(
    mkdtempSync(resolve(directory, `sunhat-install-${target}-`)),
  );
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const fixture = {
    temporary,
    target,
    root: resolve(temporary, 'project with spaces'),
    source: resolve(temporary, 'archive source'),
    archive: resolve(
      temporary,
      process.platform === 'win32' ? 'toolchain.zip' : 'toolchain.tar.gz',
    ),
    log: resolve(temporary, 'download-url.txt'),
    renameLog: resolve(temporary, 'renames.jsonl'),
  };
  writeArchive(fixture);
  const initialized = spawnSync(
    process.execPath,
    [
      '--experimental-loader',
      loader,
      '--import',
      download,
      cli,
      'init',
      '--target',
      target,
      fixture.root,
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        SUNHAT_TEST_ARCHIVE: fixture.archive,
        SUNHAT_TEST_DOWNLOAD_LOG: fixture.log,
      },
    },
  );
  assert.equal(
    initialized.status,
    0,
    initialized.stderr || String(initialized.error ?? ''),
  );
  return fixture;
}

function install(fixture, fault) {
  return spawnSync(
    process.execPath,
    [
      '--experimental-loader',
      loader,
      '--import',
      download,
      ...(fault ? ['--import', faults] : []),
      cli,
      'toolchain',
      'install',
    ],
    {
      cwd: fixture.root,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        SUNHAT_TEST_ARCHIVE: fixture.archive,
        SUNHAT_TEST_DOWNLOAD_LOG: fixture.log,
        SUNHAT_TEST_PROJECT_ROOT: fixture.root,
        SUNHAT_TEST_TARGET: fixture.target,
        SUNHAT_TEST_INSTALL_FAULT: fault ?? '',
        SUNHAT_TEST_RENAME_LOG: fixture.renameLog,
      },
    },
  );
}

function assertInstalled(result) {
  assert.equal(result.status, 0, result.stderr || String(result.error ?? ''));
}

function snapshot(root) {
  const lock = readFileSync(resolve(root, '.sunhat/toolchain.json'));
  return {
    lock,
    binaries: Object.fromEntries(
      Object.values(JSON.parse(lock).binaries).map((item) => [
        item.path,
        readFileSync(resolve(root, item.path)),
      ]),
    ),
  };
}

function assertPreserved(root, previous) {
  assert.deepEqual(
    readFileSync(resolve(root, '.sunhat/toolchain.json')),
    previous.lock,
  );
  for (const [path, bytes] of Object.entries(previous.binaries)) {
    assert.deepEqual(readFileSync(resolve(root, path)), bytes);
  }
  assertInstalled(
    spawnSync(process.execPath, [cli, 'toolchain', 'info'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    }),
  );
}

function assertClean(root, target) {
  assert.deepEqual(readdirSync(resolve(root, '.sunhat')).sort(), [
    'toolchain.json',
    'toolchains',
  ]);
  assert.deepEqual(readdirSync(resolve(root, '.sunhat/toolchains')), [target]);
}

for (const target of ['evm', 'tron']) {
  for (const [platform, arch] of [
    ['win32', 'x64'],
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64'],
  ]) {
    test(`${target} release filenames on ${platform}/${arch}`, () => {
      const release = releaseOn(target, platform, arch);
      const suffix = `${target === 'tron' ? '-tron' : ''}${platform === 'win32' ? '.exe' : ''}`;
      assert.deepEqual(
        release.tools,
        Object.fromEntries(tools.map((tool) => [tool, `${tool}${suffix}`])),
      );
      const prefix = target === 'evm' ? 'foundry_v1.8.6' : 'foundry-tron';
      assert.equal(
        release.archive,
        `${prefix}_${platform}_${arch === 'x64' ? 'amd64' : arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`,
      );
    });
  }

  test(`${process.platform} ${target} archive installs all executables and records metadata`, (t) => {
    const windows = process.platform === 'win32';
    const fixture = installFixture(t, target);
    const { root, log, contents } = fixture;
    assertInstalled(install(fixture));
    const release = releaseFor(target);
    assert.equal(
      readFileSync(log, 'utf8'),
      `https://github.com/${release.source}/releases/download/${release.release}/${release.archive}`,
    );
    const lock = JSON.parse(
      readFileSync(resolve(root, '.sunhat/toolchain.json'), 'utf8'),
    );
    assert.equal(lock.version, 2);
    assert.equal(lock.target, target);
    assert.equal(
      lock.platform,
      `${process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`,
    );
    assert.equal(lock.source, release.source);
    assert.equal(lock.release, release.release);
    assert.equal(lock.revision, release.revision);
    assert.deepEqual(Object.keys(lock.binaries).sort(), [...tools].sort());
    assert.deepEqual(
      readdirSync(resolve(root, `.sunhat/toolchains/${target}`)).sort(),
      Object.keys(contents).sort(),
    );
    for (const [tool, item] of Object.entries(lock.binaries)) {
      const filename = `${tool}${target === 'tron' ? '-tron' : ''}${windows ? '.exe' : ''}`;
      assert.equal(item.path, `.sunhat/toolchains/${target}/${filename}`);
      assert.deepEqual(
        readFileSync(resolve(root, item.path)),
        contents[filename],
      );
      assert.deepEqual(Object.keys(item), ['path']);
      if (windows) {
        assert.equal(
          existsSync(
            resolve(
              root,
              `.sunhat/toolchains/${target}/${filename.slice(0, -4)}`,
            ),
          ),
          false,
        );
      }
    }
    const info = spawnSync(process.execPath, [cli, 'toolchain', 'info'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(info.status, 0, info.stderr || String(info.error ?? ''));
    assertClean(root, target);
    const rejected = spawnSync(process.execPath, [cli, 'toolchain', 'check'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(
      rejected.status,
      2,
      rejected.stderr || String(rejected.error ?? ''),
    );
    assert.match(
      rejected.stderr,
      /toolchain requires exactly one command: install or info/u,
    );
  });

  test(`${target} reinstall works across simulated filesystem boundaries`, (t) => {
    const fixture = installFixture(t, target);
    assertInstalled(install(fixture));
    const previous = snapshot(fixture.root);
    writeArchive(fixture, { label: 'replacement' });
    assertInstalled(install(fixture, 'cross-device'));
    const installed = snapshot(fixture.root);
    assert.deepEqual(installed.lock, previous.lock);
    for (const [path, bytes] of Object.entries(installed.binaries)) {
      assert.notDeepEqual(bytes, previous.binaries[path]);
      assert.deepEqual(bytes, fixture.contents[path.split('/').at(-1)]);
    }
    assert.ok(
      readFileSync(fixture.renameLog, 'utf8').trim().split('\n').length > 0,
    );
    assertPreserved(fixture.root, installed);
    assertClean(fixture.root, target);
  });

  test(`${target} incomplete archive leaves the previous installation intact`, (t) => {
    const fixture = installFixture(t, target);
    assertInstalled(install(fixture));
    const previous = snapshot(fixture.root);
    writeArchive(fixture, {
      label: 'incomplete replacement',
      missingTool: 'chisel',
    });
    const rejected = install(fixture);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /ENOENT/u);
    assertPreserved(fixture.root, previous);
    assertClean(fixture.root, target);
  });

  for (const fault of ['activate', 'lock']) {
    test(`${target} ${fault} failure restores the previous binaries and lock`, (t) => {
      const fixture = installFixture(t, target);
      assertInstalled(install(fixture));
      const previous = snapshot(fixture.root);
      writeArchive(fixture, { label: 'replacement' });
      const rejected = install(fixture, fault);
      assert.notEqual(rejected.status, 0);
      assert.match(
        rejected.stderr,
        new RegExp(`injected ${fault} failure`, 'u'),
      );
      assertPreserved(fixture.root, previous);
      assertClean(fixture.root, target);
    });
  }

  test(`${target} failed rollback retains a recoverable backup`, (t) => {
    const fixture = installFixture(t, target);
    assertInstalled(install(fixture));
    const previous = snapshot(fixture.root);
    writeArchive(fixture, { label: 'replacement' });
    const rejected = install(fixture, 'rollback');
    assert.notEqual(rejected.status, 0);
    const toolchains = resolve(fixture.root, '.sunhat/toolchains');
    const stages = readdirSync(toolchains).filter((name) =>
      name.startsWith(`.install-${target}-`),
    );
    assert.equal(stages.length, 1);
    const backup = resolve(toolchains, stages[0], 'previous');
    assert.ok(
      rejected.stderr.includes(`previous toolchain preserved at ${backup}`),
      rejected.stderr,
    );
    assert.deepEqual(
      readFileSync(resolve(fixture.root, '.sunhat/toolchain.json')),
      previous.lock,
    );
    for (const [path, bytes] of Object.entries(previous.binaries)) {
      assert.deepEqual(
        readFileSync(resolve(backup, path.split('/').at(-1))),
        bytes,
      );
    }
    renameSync(backup, resolve(toolchains, target));
    assertPreserved(fixture.root, previous);
  });

  test(
    `${target} installs on a different Linux filesystem from OS temp`,
    { skip: process.platform !== 'linux' },
    (t) => {
      let fixture;
      try {
        fixture = installFixture(t, target, '/dev/shm');
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'EACCES') {
          throw error;
        }
        t.skip('/dev/shm is unavailable');
        return;
      }
      if (statSync(fixture.temporary).dev === statSync(tmpdir()).dev) {
        t.skip('/dev/shm and OS temp share a filesystem');
        return;
      }
      assertInstalled(install(fixture));
      assertPreserved(fixture.root, snapshot(fixture.root));
      assertClean(fixture.root, target);
    },
  );
}
