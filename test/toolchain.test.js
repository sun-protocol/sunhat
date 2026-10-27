import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { releaseFor } from '../dist/toolchain/releases.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const cli = resolve(repository, 'bin/sunhat.js');
const loader = new URL('./fixtures/toolchain-install-loader.js', import.meta.url).href;
const download = new URL('./fixtures/toolchain-install-download.js', import.meta.url).href;
const tools = ['forge', 'cast', 'anvil', 'chisel'];

function releaseOn(target, platform, arch) {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
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

for (const target of ['evm', 'tron']) {
  for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'arm64'], ['linux', 'x64']]) {
    test(`${target} release filenames on ${platform}/${arch}`, () => {
      const release = releaseOn(target, platform, arch);
      const suffix = `${target === 'tron' ? '-tron' : ''}${platform === 'win32' ? '.exe' : ''}`;
      assert.deepEqual(release.tools, Object.fromEntries(tools.map(tool => [tool, `${tool}${suffix}`])));
      const prefix = target === 'evm' ? 'foundry_v1.8.6' : 'foundry-tron';
      assert.equal(release.archive, `${prefix}_${platform}_${arch === 'x64' ? 'amd64' : arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`);
    });
  }

  test(`${process.platform} ${target} archive installs all executables and verifies the lock`, (t) => {
    const windows = process.platform === 'win32';
    const temporary = mkdtempSync(resolve(tmpdir(), `sunhat-install-${target}-`));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const root = resolve(temporary, 'project with spaces');
    const source = resolve(temporary, 'archive source');
    const archive = resolve(temporary, windows ? 'toolchain.zip' : 'toolchain.tar.gz');
    const log = resolve(temporary, 'download-url.txt');
    mkdirSync(source);
    const contents = Object.fromEntries(tools.map(tool => [`${tool}${target === 'tron' ? '-tron' : ''}${windows ? '.exe' : ''}`, Buffer.from(`${process.platform} ${target} ${tool} fixture\n`)]));
    for (const [filename, bytes] of Object.entries(contents)) writeFileSync(resolve(source, filename), bytes);

    const literal = value => `'${value.replaceAll("'", "''")}'`;
    const files = Object.keys(contents).map(filename => literal(resolve(source, filename))).join(', ');
    const compressed = windows
      ? spawnSync('powershell.exe', ['-NoProfile', '-Command', `$ErrorActionPreference = 'Stop'; Compress-Archive -LiteralPath @(${files}) -DestinationPath ${literal(archive)}`], { encoding: 'utf8', timeout: 30_000 })
      : spawnSync('tar', ['-czf', archive, '-C', source, ...Object.keys(contents)], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(compressed.status, 0, compressed.stderr || String(compressed.error ?? ''));
    const initialized = spawnSync(process.execPath, [cli, 'init', '--target', target, root], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(initialized.status, 0, initialized.stderr || String(initialized.error ?? ''));

    const installed = spawnSync(process.execPath, ['--experimental-loader', loader, '--import', download, cli, 'toolchain', 'install'], {
      cwd: root, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, SUNHAT_TEST_ARCHIVE: archive, SUNHAT_TEST_DOWNLOAD_LOG: log },
    });
    assert.equal(installed.status, 0, installed.stderr || String(installed.error ?? ''));
    const release = releaseFor(target);
    assert.equal(readFileSync(log, 'utf8'), `https://github.com/${release.source}/releases/download/${release.release}/${release.archive}`);
    const lock = JSON.parse(readFileSync(resolve(root, '.sunhat/toolchain.json'), 'utf8'));
    assert.equal(lock.version, 1);
    assert.equal(lock.target, target);
    assert.equal(lock.platform, `${process.platform}-${process.arch === 'x64' ? 'amd64' : process.arch}`);
    assert.equal(lock.source, release.source);
    assert.equal(lock.release, release.release);
    assert.equal(lock.revision, release.revision);
    assert.deepEqual(Object.keys(lock.binaries).sort(), [...tools].sort());
    assert.deepEqual(readdirSync(resolve(root, `.sunhat/toolchains/${target}`)).sort(), Object.keys(contents).sort());
    for (const [tool, item] of Object.entries(lock.binaries)) {
      const filename = `${tool}${target === 'tron' ? '-tron' : ''}${windows ? '.exe' : ''}`;
      assert.equal(item.path, `.sunhat/toolchains/${target}/${filename}`);
      assert.deepEqual(readFileSync(resolve(root, item.path)), contents[filename]);
      assert.equal(item.sha256, createHash('sha256').update(contents[filename]).digest('hex'));
      if (windows) assert.equal(existsSync(resolve(root, `.sunhat/toolchains/${target}/${filename.slice(0, -4)}`)), false);
    }
    const checked = spawnSync(process.execPath, [cli, 'toolchain', 'check'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
    assert.equal(checked.status, 0, checked.stderr || String(checked.error ?? ''));
    writeFileSync(resolve(root, lock.binaries.forge.path), 'tampered');
    const rejected = spawnSync(process.execPath, [cli, 'toolchain', 'check'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
    assert.equal(rejected.status, 3, rejected.stderr || String(rejected.error ?? ''));
    assert.match(rejected.stderr, /forge digest mismatch/u);
  });
}
