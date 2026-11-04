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
  //   2. Per-source/version Promise dedup. Multiple compiles in the same
  //      process asking for the same version coalesce onto one
  //      download; different versions proceed independently.
  //
  //   3. Each attempt writes a unique staging file and activates it
  //      only after verification. Failed attempts clean their own staging
  //      file; the existing compiler remains available until replacement.
  //
  // Mirror-specific directories separate identical long versions from
  // different sources. The cached .cjs suffix also supports explicit cache
  // directories inside ESM projects; download URLs retain upstream .js names.

  const fs = deps.fs ?? require('node:fs');
  const crypto = require('node:crypto');
  const { pipeline } = require('node:stream/promises');
  const { Readable } = require('node:stream');
  const { Worker } = require('node:worker_threads');
  const path = require('node:path');

  const { TronCompileError } = deps.errors;
  const manifest = deps.manifest;

  // mirror identity + short version -> Promise<{ compilerPath, version, longVersion }>
  const _inFlight = new Map();

  // soljson installs global process listeners when loaded. Isolate probes
  // from the host and terminate each worker, including failed or hung loads.
  async function loadAndCheckVersion(absPath, expectedShortVersion) {
    const worker = new Worker(path.join(__dirname, 'version-worker.js'), {
      workerData: absPath,
    });
    let timer;
    let failed = false;
    let operationError;
    let versionString;
    try {
      versionString = await new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Compiler version probe timed out')),
          90000,
        );
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', (code) =>
          reject(
            new Error(
              `Compiler version probe exited without a result (${code})`,
            ),
          ),
        );
      });
      if (
        typeof versionString !== 'string' ||
        !versionString.startsWith(expectedShortVersion + '+')
      ) {
        throw new TronCompileError(
          `tron-solc wasm at ${absPath} reports version '${versionString}', expected prefix '${expectedShortVersion}+'`,
        );
      }
    } catch (error) {
      failed = true;
      const detail =
        error instanceof Error
          ? error.message
          : 'compiler threw a non-Error value';
      operationError =
        error instanceof TronCompileError
          ? error
          : new TronCompileError(
              `failed to load tron-solc wasm at ${absPath}: ${detail}`,
              error,
            );
    }
    clearTimeout(timer);
    try {
      await worker.terminate();
    } catch (error) {
      if (!failed) {
        throw error;
      }
      try {
        console.error('Failed to terminate compiler version probe:', error);
      } catch {
        /* Preserve the original compiler error. */
      }
    }
    if (failed) {
      throw operationError;
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
    const dir = await manifest.compilerCacheDir(opts.mirror);
    fs.mkdirSync(dir, { recursive: true });

    const finalPath = await manifest.compilerPath(
      build.longVersion,
      opts.mirror,
    );
    const tmpPath = finalPath + '.' + crypto.randomUUID() + '.cjs';

    // Fast path: file is already on disk. Re-verify SHA-256 to catch
    // disk corruption / tampering. If verification fails, fall through
    // to a fresh staged download while retaining the old file.
    if (fs.existsSync(finalPath)) {
      try {
        const got = sha256OfFile(finalPath);
        if (
          got.toLowerCase().replace(/^0x/, '') ===
          build.sha256.toLowerCase().replace(/^0x/, '')
        ) {
          // Also verify loadability + version string, defence-in-depth
          // against a manifest entry that's correct but points at the
          // wrong wasm version.
          await loadAndCheckVersion(finalPath, build.version);
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

    const url = manifest.mirrorUrl(opts.mirror, build.path);
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
      await loadAndCheckVersion(tmpPath, build.version);
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

    // Capture the source before awaiting; a caller may reuse its options.
    opts = { ...opts, mirror: manifest.normalizeMirror(opts.mirror) };
    const key = manifest.mirrorKey(opts.mirror) + ':' + version;
    if (_inFlight.has(key)) {
      return _inFlight.get(key);
    }

    const p = (async () => {
      const build = await manifest.resolveBuild(version, opts);
      return downloadInner(build, opts);
    })();

    _inFlight.set(key, p);
    try {
      return await p;
    } finally {
      if (_inFlight.get(key) === p) {
        _inFlight.delete(key);
      }
    }
  }

  return { getCompiler };
};
