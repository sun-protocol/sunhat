'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule(deps) {
  // Fetches a tron-solc wasm and stages it at a predictable cache path.
  // Three things that matter here:
  //
  //   1. SHA-256 integrity verification against the manifest. Real
  //      cryptographic verification, not just "did the file load
  //      without throwing" -- a corrupt-but-loadable wasm or a MITM
  //      with a malicious wasm that happens to report the right
  //      version string would pass loadability and still be wrong.
  //      Same threat model as Hardhat's stock solc downloader.
  //
  //   2. Per-version Promise dedup. Multiple compiles in the same
  //      process asking for the same version coalesce onto one
  //      download; different versions proceed independently.
  //
  //   3. Atomic staging via .tmp + rename. An interrupted download
  //      leaves a .tmp file we delete on the next attempt; the final
  //      path is never partially written, so a concurrent process
  //      checking existence either sees nothing (no file) or the
  //      completed file.
  //
  // Cache key path is `<compilerCacheDir>/soljson-v<longVersion>.js`
  // (matches the upstream filename verbatim, e.g.
  // `soljson-v0.8.26+commit.733b4d28.js`). Long version is the source
  // of truth -- two builds with the same short version but different
  // commits are distinct on disk.
  //

  const fs = deps.fs ?? require('node:fs');
  const crypto = require('node:crypto');
  const { pipeline } = require('node:stream/promises');
  const { Readable } = require('node:stream');
  const wrapper = require('solc/wrapper');

  const { TronCompileError } = deps.errors;
  const manifest = deps.manifest;

  // version (short) -> Promise<{ compilerPath, version, longVersion }>
  const _inFlight = new Map();

  // Bust the require cache before loading so a re-run picks up a fresh
  // download. solc/wrapper holds a module-level reference to the
  // soljson module object, and a stale cache entry would silently keep
  // us on the old wasm.
  function loadAndCheckVersion(absPath, expectedShortVersion) {
    delete require.cache[require.resolve(absPath)];
    let solc;
    try {
      const soljson = require(absPath);
      solc = wrapper(soljson);
    } catch (e) {
      throw new TronCompileError(
        `failed to load tron-solc wasm at ${absPath}: ${e.message}`,
        e,
      );
    }
    const versionString =
      (typeof solc.version === 'function' ? solc.version() : '') || '';
    if (!versionString.startsWith(expectedShortVersion + '+')) {
      throw new TronCompileError(
        `tron-solc wasm at ${absPath} reports version '${versionString}', expected prefix '${expectedShortVersion}+'`,
      );
    }
    return versionString;
  }

  function sha256OfFile(absPath) {
    const buf = fs.readFileSync(absPath);
    return '0x' + crypto.createHash('sha256').update(buf).digest('hex');
  }

  async function streamToFile(url, destAbs) {
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(90000) });
    } catch (e) {
      throw new TronCompileError(`fetch failed for ${url}: ${e.message}`, e);
    }
    if (!res.ok) {
      throw new TronCompileError(
        `fetch returned HTTP ${res.status} for ${url}`,
      );
    }
    if (!res.body) {
      throw new TronCompileError(`fetch returned no body for ${url}`);
    }
    const out = fs.createWriteStream(destAbs);
    await pipeline(Readable.fromWeb(res.body), out);
  }

  async function downloadInner(build, opts) {
    const dir = manifest.compilerCacheDir();
    fs.mkdirSync(dir, { recursive: true });

    const finalPath = manifest.compilerPath(build.longVersion);
    const tmpPath = finalPath + '.' + crypto.randomUUID() + '.cjs';

    // Fast path: file is already on disk. Re-verify SHA-256 to catch
    // disk corruption / tampering. If verification fails, fall through
    // to a fresh staged download while retaining the old file.
    if (fs.existsSync(finalPath)) {
      try {
        const got = sha256OfFile(finalPath);
        if (got.toLowerCase() === build.sha256.toLowerCase()) {
          // Also verify loadability + version string, defence-in-depth
          // against a manifest entry that's correct but points at the
          // wrong wasm version.
          loadAndCheckVersion(finalPath, build.version);
          return {
            compilerPath: finalPath,
            version: build.version,
            longVersion: build.longVersion,
          };
        }
        // SHA mismatch on cached file -- something tampered with it
        // OR the upstream manifest changed. Either way, refetch.
      } catch {
        // Corrupted file: refetch into a unique staging file.
      }
      // Keep the old file until a verified staging file atomically replaces it.
    }

    const mirror = opts.mirror.replace(/\/$/, '');
    const url = `${mirror}/wasm/${build.path}`;
    try {
      await streamToFile(url, tmpPath);
      const got = sha256OfFile(tmpPath);
      if (
        got.toLowerCase().replace(/^0x/, '') !==
        build.sha256.toLowerCase().replace(/^0x/, '')
      ) {
        throw new TronCompileError(
          `tron-solc download from ${url} failed sha256 verification (expected ${build.sha256}, got ${got})`,
        );
      }
      loadAndCheckVersion(tmpPath, build.version);
      fs.renameSync(tmpPath, finalPath);
    } catch (error) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch (cleanupError) {
        try {
          console.error('Failed to clean compiler staging file:', cleanupError);
        } catch {
          /* Preserve the primary exception. */
        }
      }
      throw error;
    }

    return {
      compilerPath: finalPath,
      version: build.version,
      longVersion: build.longVersion,
    };
  }

  // Public entry. Returns { compilerPath, version, longVersion }.
  // `opts.mirror` is required (the consumer's tre.compiler.mirror config).
  async function getCompiler(version, opts) {
    if (typeof version !== 'string' || !version) {
      throw new TronCompileError(
        `getCompiler: version must be a non-empty string, got ${JSON.stringify(version)}`,
      );
    }
    if (!opts || typeof opts.mirror !== 'string') {
      throw new TronCompileError(`getCompiler: opts.mirror is required`);
    }

    // Promise dedup keyed by short version. Different versions can
    // download concurrently; the same version coalesces.
    if (_inFlight.has(version)) {
      return _inFlight.get(version);
    }

    const p = (async () => {
      const build = await manifest.resolveBuild(version, opts);
      return downloadInner(build, opts);
    })();

    _inFlight.set(version, p);
    try {
      return await p;
    } finally {
      _inFlight.delete(version);
    }
  }

  return { getCompiler };
};
