'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule(deps) {
  // Source-of-truth for which tron-solc versions exist and what their
  // SHA-256 digests should be. The canonical mirror is
  // `tronprotocol/solc-bin` -- it publishes a `list.json` with the same
  // shape as `ethereum/solc-bin`, so we can do real integrity
  // verification against the published manifest rather than relying on
  // "does the file load?" as a proxy for correctness.
  //
  // Caching strategy:
  //   * Cache list.json under Hardhat's own compiler-cache root so a
  //     `hardhat clean --global` (or manual nuke) clears it alongside
  //     stock solc wasms. No `~/.tron/solc` directory.
  //   * 24h TTL. After that the cached file is refreshed on the next
  //     compile that needs a version lookup.
  //   * Stale-on-network-failure: if the upstream fetch fails AND we
  //     have a cached copy (any age), fall back to it with a warning.
  //     This keeps offline compiles working.
  //   * If a requested version is absent from a stale cache, force a
  //     refresh ignoring the TTL -- the version might have just been
  //     published.
  //

  const fs = require('node:fs');
  const path = require('node:path');
  const { createHash, randomUUID } = require('node:crypto');

  const { TronCompileError } = deps.errors;

  // 24 hours.
  const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

  function normalizeMirror(mirror) {
    const url = new URL(mirror);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new TronCompileError('Compiler mirror must use HTTP or HTTPS');
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.hash = '';
    return url.href;
  }

  function mirrorKey(mirror) {
    return createHash('sha256').update(normalizeMirror(mirror)).digest('hex');
  }

  function mirrorUrl(mirror, filename) {
    const url = new URL(normalizeMirror(mirror));
    url.pathname = url.pathname.replace(/\/+$/, '') + '/wasm/' + filename;
    return url.href;
  }

  async function compilerCacheDir(mirror) {
    // The adapter supplies the host cache root. Standalone consumers use
    // the same public helper lazily, without loading Hardhat internals.
    const root =
      deps.cacheDir ??
      path.join(
        await (
          await import('@nomicfoundation/hardhat-utils/global-dir')
        ).getCacheDir(),
        'compilers-v3',
        'wasm',
        'tron-solc',
      );
    return path.join(root, 'mirrors', mirrorKey(mirror));
  }

  async function manifestPath(mirror) {
    return path.join(await compilerCacheDir(mirror), 'list.json');
  }

  async function compilerPath(longVersion, mirror) {
    // Explicit cache overrides may live inside a type:module project.
    return path.join(
      await compilerCacheDir(mirror),
      `soljson-v${longVersion}.cjs`,
    );
  }

  // Manifest entry shape (matches upstream list.json):
  //   { path, version, build, longVersion, keccak256, sha256, urls }
  // We only consume `version`, `longVersion`, `path`, and `sha256`.

  function validManifest(value) {
    return (
      value !== null &&
      typeof value === 'object' &&
      Array.isArray(value.builds) &&
      value.builds.every(
        (build) =>
          build !== null &&
          typeof build === 'object' &&
          typeof build.version === 'string' &&
          /^\d+\.\d+\.\d+$/.test(build.version) &&
          typeof build.longVersion === 'string' &&
          /^[\w.+-]+$/.test(build.longVersion) &&
          typeof build.path === 'string' &&
          build.path === `soljson-v${build.longVersion}.js` &&
          typeof build.sha256 === 'string' &&
          /^(?:0x)?[a-fA-F0-9]{64}$/.test(build.sha256),
      )
    );
  }

  async function fetchUpstream(mirror) {
    const url = mirrorUrl(mirror, 'list.json');
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(90000) });
    } catch (e) {
      throw new TronCompileError(
        `failed to fetch tron-solc manifest from ${url}: ${e.message}`,
        e,
      );
    }
    if (!res.ok) {
      throw new TronCompileError(
        `tron-solc manifest fetch returned HTTP ${res.status} from ${url}`,
      );
    }
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new TronCompileError(
        `tron-solc manifest at ${url} is not valid JSON: ${e.message}`,
        e,
      );
    }
    if (!validManifest(parsed)) {
      throw new TronCompileError(
        `tron-solc manifest at ${url} has no builds[] array`,
      );
    }
    return { parsed, text };
  }

  async function readCached(mirror) {
    const p = await manifestPath(mirror);
    if (!fs.existsSync(p)) {
      return null;
    }
    const stat = fs.statSync(p);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
    if (!validManifest(parsed)) {
      return null;
    }
    return { parsed, mtimeMs: stat.mtimeMs };
  }

  async function writeCache(text, mirror) {
    const dir = await compilerCacheDir(mirror);
    fs.mkdirSync(dir, { recursive: true });
    // Atomic-ish write: tmp + rename. Concurrent compiles in the same
    // process are dedup'd by the in-flight Promise map at the call
    // site; concurrent compiles across processes might race here, but
    // rename is atomic on POSIX, and we'd just end up with one
    // process's copy.
    const target = await manifestPath(mirror);
    const tmp = target + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(tmp, text, { flag: 'wx' });
      fs.renameSync(tmp, target);
    } catch (error) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch (cleanupError) {
        try {
          console.error(
            'Failed to clean compiler manifest staging file:',
            cleanupError,
          );
        } catch {
          /* Preserve the original thrown value. */
        }
      }
      throw error;
    }
  }

  // In-flight dedup for the manifest fetch itself -- avoids hammering
  // the upstream when multiple compiles happen back-to-back in the same
  // process.
  const _inFlight = new Map();

  async function loadManifest({
    mirror,
    ttlMs = DEFAULT_TTL_MS,
    forceRefresh = false,
  }) {
    mirror = normalizeMirror(mirror);
    const key = mirrorKey(mirror);
    if (!forceRefresh) {
      const cached = await readCached(mirror);
      if (cached && Date.now() - cached.mtimeMs < ttlMs) {
        return cached.parsed;
      }
    }
    if (_inFlight.has(key)) {
      return _inFlight.get(key);
    }

    const pending = (async () => {
      try {
        const { parsed, text } = await fetchUpstream(mirror);
        await writeCache(text, mirror);
        return parsed;
      } catch (e) {
        // Offline fallback must retain the selected source identity.
        const cached = await readCached(mirror);
        if (cached) {
          console.warn(
            `[hardhat-tron] tron-solc manifest refresh failed (${e.message}); using stale cache from ${new Date(
              cached.mtimeMs,
            ).toISOString()}`,
          );
          return cached.parsed;
        }
        throw e;
      }
    })();
    _inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (_inFlight.get(key) === pending) {
        _inFlight.delete(key);
      }
    }
  }

  // Find a build entry by exact short version. Returns null if absent.
  function findBuild(manifest, version) {
    return manifest.builds.find((b) => b.version === version) || null;
  }

  // Resolve a version: try the cached manifest first, refresh if absent.
  // Throws TronCompileError if still absent after refresh.
  async function resolveBuild(version, opts) {
    opts = { ...opts, mirror: normalizeMirror(opts.mirror) };
    let manifest = await loadManifest(opts);
    let build = findBuild(manifest, version);
    if (!build) {
      manifest = await loadManifest({ ...opts, forceRefresh: true });
      build = findBuild(manifest, version);
    }
    if (!build) {
      throw new TronCompileError(
        `tron-solc version ${version} not found in manifest (mirror=${opts.mirror}). ` +
          `Available: ${manifest.builds.map((b) => b.version).join(', ')}`,
      );
    }
    if (
      typeof build.sha256 !== 'string' ||
      !/^(?:0x)?[0-9a-f]{64}$/i.test(build.sha256)
    ) {
      throw new TronCompileError(
        `manifest entry for ${version} has invalid sha256: ${build.sha256}`,
      );
    }
    return build;
  }

  // Lowest-overhead helper for callers that just need the list of known
  // versions (e.g. config validation, error messages).
  async function knownVersions(opts) {
    const manifest = await loadManifest(opts);
    return manifest.builds.map((b) => b.version);
  }

  return {
    normalizeMirror,
    mirrorKey,
    mirrorUrl,
    compilerCacheDir,
    manifestPath,
    compilerPath,
    loadManifest,
    resolveBuild,
    knownVersions,
    DEFAULT_TTL_MS,
  };
};
