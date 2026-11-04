'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule(deps) {
  // A stable identifier for a specific TRE node instance, resolved in four
  // tiers, each tried only if the one before it does not apply:
  //
  //   0. Node-served: a patched TRE answers `tre_instanceId` directly over RPC
  //      (nodeServedInstanceId) — a random id generated once per node process.
  //      Any observer, including one docker-blind to the container, resolves
  //      the same value, so this short-circuits tiers 1-2 entirely. Deliberately
  //      probed for ANY url, not just local ones, so a remote self-hosted
  //      patched TRE still answers; a network that does not answer this costs
  //      at most ~4s (two 2s attempts); an unanswered probe leaves the id
  //      provisional and is re-probed on later calls with two attempts per call.
  //   1. Owned: this plugin launched the container (lifecycle.launchedContainerFor).
  //      Its identity is read via `docker inspect` and MUST succeed — a failure
  //      here throws rather than falling through to a weaker tier, since we know
  //      a container exists and silently substituting a different id would be
  //      wrong, not merely imprecise.
  //   2. Discovered: some other local process launched the container, but it is
  //      still identifiable by the docker daemon from the url's host and port
  //      (lifecycle.containerServing). Host ports are only exclusive within IPv4
  //      on a single interface (127.0.0.1/.2 and [::1] can each carry a
  //      different container on one port, and `docker ps --filter publish` is
  //      blind to IPv6-only bindings on Docker Desktop), so the lookup matches
  //      the url's exact host and requires the TRE's fixed 9090/tcp container
  //      port. Not forwarder-proof: a proxy that itself uses 9090 internally
  //      would still be misattributed — only tier 0 is forwarder-proof. Same
  //      hash formula as tier 1 (hashContainerIdentity), so an owned and a
  //      foreign observer of the same container agree on its id.
  //   3. Genesis fallback: no docker container could be attributed to the url
  //      (remote daemon, non-loopback host, or docker unavailable). The genesis
  //      (block 0) hash is a constant shared by every TRE booted from the same
  //      image and startup env, so it cannot distinguish two such TREs, or two
  //      deterministic restarts of the same one. Consumers that need a
  //      guaranteed-fresh id per restart should let this plugin manage the
  //      container lifecycle (tier 1) or run it where tier 2 can see it.
  //
  // Container identity (tiers 1-2) is per-boot fresh because every boot is a
  // fresh `docker run` with a new container id: TRE containers are single-boot
  // by construction (the image corrupts its own fullnode.conf on restart), so
  // the lifecycle never reuses a container — which is exactly why a per-boot id
  // is correct. `StartedAt` participates in the hash as a belt-and-braces guard
  // against an out-of-band `docker start` of a foreign container.
  //
  // The id is resolved once and cached per url when the tier-0 probe got an
  // answer. When it did not (timeout, dropped socket), the fallback id is held
  // provisionally: later calls re-probe tier 0 (bounded per call) so a node that was
  // merely mid-hiccup converges on its served id. `networkName` is accepted for
  // the caller's convenience but does not participate in the key: id derivation
  // depends only on the url, and two networks sharing a url point at the same
  // node and must share an id.

  const { spawnSync } = require('node:child_process');
  const crypto = require('node:crypto');
  const { requestJson, describeEndpoint } = require('./transport');

  const lifecycle = deps.lifecycle;

  const _instanceIdCache = new Map();

  // Shared hashing site for both container-derived tiers (owned and discovered),
  // so they cannot drift and produce different ids for the same container.
  function hashContainerIdentity(id, startedAt) {
    return (
      '0x' +
      crypto.createHash('sha256').update(`${id}|${startedAt}`).digest('hex')
    );
  }

  // Shared field validation for both container-derived tiers: rejects an empty
  // id, an empty startedAt, or either containing docker's own "<no value>"
  // placeholder (an unset Go template field), before it ever reaches the hash.
  function validatedContainerIdentity(id, startedAt) {
    if (
      !id ||
      !startedAt ||
      id.includes('<no value>') ||
      startedAt.includes('<no value>')
    ) {
      return undefined;
    }
    return hashContainerIdentity(id, startedAt);
  }

  // docker container id + StartedAt, hashed. On failure returns { failure }
  // carrying docker's own stderr so the owned-path throw can name the cause.
  function containerInstanceId(containerName) {
    const r = spawnSync(
      'docker',
      ['inspect', '--format', '{{.Id}}|{{.State.StartedAt}}', containerName],
      {
        encoding: 'utf8',
      },
    );
    if (r.status !== 0) {
      const detail =
        (r.stderr || '').trim() ||
        (r.error && r.error.message) ||
        `docker inspect exited ${r.status}`;
      return { failure: detail };
    }
    const raw = (r.stdout || '').trim();
    const s = raw.indexOf('|');
    const id =
      s === -1
        ? undefined
        : validatedContainerIdentity(raw.slice(0, s), raw.slice(s + 1));
    return id
      ? { id }
      : { failure: `unexpected docker inspect output: ${JSON.stringify(raw)}` };
  }

  const PROBE_TIMEOUT_MS = 2000;
  const PROBE_RETRY_DELAY_MS = 100;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Single attempt at tier 0: fetch tre_instanceId with a fresh timeout. A
  // stock node answers with a parsed JSON-RPC error, which resolves to
  // undefined -- an answer, not a probe failure. Transient statuses (408, 429,
  // 5xx) are thrown so an intermediary's error page is not mistaken for a
  // definitive answer.
  async function fetchNodeServedInstanceId(url, httpHeaders) {
    const body = await requestJson(url, '/tre', {
      headers: httpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tre_instanceId',
        params: [],
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (body?.error?.code === -32601) {
      return undefined;
    }
    if (
      body &&
      !Array.isArray(body) &&
      body.error === undefined &&
      typeof body.result === 'string' &&
      /^0x[0-9a-f]{64}$/.test(body.result)
    ) {
      return body.result;
    }
    throw new Error('Invalid tre_instanceId response', { cause: body });
  }

  // Tier 0 probe. { id, definitive: true } -- the node served an id;
  // { id: undefined, definitive: true } -- the node answered, tier 0 does not
  // apply; { id: undefined, definitive: false } -- no answer arrived after a
  // retry, so the caller must not commit this observer away from the served id.
  async function nodeServedInstanceId(url, httpHeaders) {
    for (let attempt = 0; ; attempt++) {
      try {
        return {
          id: await fetchNodeServedInstanceId(url, httpHeaders),
          definitive: true,
        };
      } catch {
        if (attempt >= 1) {
          return { id: undefined, definitive: false };
        }
        // The GC pause that dropped the socket may still be running; an
        // instant retry would just hit it again.
        await sleep(PROBE_RETRY_DELAY_MS);
      }
    }
  }

  // Genesis block hash over plain JSON-RPC. java-tron reports the Tron block ID
  // as the block's `hash` (0x-prefixed), so this matches the id TronWeb's
  // `trx.getBlock(0).blockID` would yield — without needing a TronWeb client,
  // whose construction requires a private key the read itself does not.
  async function genesisInstanceId(provider, url) {
    const genesis = await provider.request({
      method: 'eth_getBlockByNumber',
      params: ['0x0', false],
    });
    const hash = genesis && genesis.hash;
    if (!hash) {
      throw new Error(
        `Could not read the genesis block hash from ${describeEndpoint(url)} to derive a TRE instance id.`,
      );
    }
    return hash;
  }

  const _inflight = new Map();
  const _evictGen = new Map();

  function commit(url, id) {
    _instanceIdCache.set(url, { id, provisional: false });
    return id;
  }

  const keysByUrl = new Map();
  function cacheKey({ url, httpHeaders }) {
    const headers = [...new Headers(httpHeaders).entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return crypto
      .createHash('sha256')
      .update(JSON.stringify([url, headers]))
      .digest('hex');
  }

  // Credentials can route one URL to different tenant nodes. Coalesce only
  // requests that describe the same authenticated endpoint.
  async function instanceId(opts) {
    const request = {
      ...opts,
      httpHeaders: Object.fromEntries(new Headers(opts.httpHeaders).entries()),
    };
    const key = cacheKey(request);
    let keys = keysByUrl.get(request.url);
    if (!keys) {
      keys = new Set();
      keysByUrl.set(request.url, keys);
    }
    keys.add(key);
    const cached = _instanceIdCache.get(key);
    if (cached && !cached.provisional) {
      return cached.id;
    }
    let p = _inflight.get(key);
    if (!p) {
      p = resolveInstanceId(request, key).finally(() => {
        if (_inflight.get(key) === p) {
          _inflight.delete(key);
        }
      });
      _inflight.set(key, p);
    }
    return p;
  }

  async function resolveInstanceId({ url, provider, httpHeaders }, key) {
    // A cache write is void if teardown evicted the url while a probe was in
    // flight: the resolved id belongs to the instance that was just removed.
    const gen = _evictGen.get(key) || 0;
    const evicted = () => (_evictGen.get(key) || 0) !== gen;

    const cached = _instanceIdCache.get(key);
    if (cached && !cached.provisional) {
      return cached.id;
    }

    if (cached) {
      // The probe that produced this id never got an answer, so the node may
      // serve an id every other observer already agrees on. Re-probe tier 0
      // only: the lower tiers are deterministic and cannot change.
      const probe = await nodeServedInstanceId(url, httpHeaders);
      const id = probe.id || cached.id;
      if (evicted()) {
        return id;
      }
      if (probe.definitive) {
        return commit(key, id);
      }
      // A transient failure never becomes permanent evidence of absence.
      // Each subsequent call retries at most twice before returning fallback.
      return cached.id;
    }

    const probe = await nodeServedInstanceId(url, httpHeaders);
    let id = probe.id;
    if (!id) {
      const ownedName = lifecycle.launchedContainerFor(url);
      if (ownedName) {
        // We launched this container, so its identity is readable by contract;
        // falling back would substitute an id that repeats across restarts.
        const owned = containerInstanceId(ownedName);
        id = owned.id;
        if (!id) {
          throw new Error(
            `hardhat-tron launched the TRE container "${ownedName}" for ${describeEndpoint(url)} ` +
              `but could not read its docker identity: ${owned.failure}. ` +
              `Check that docker is still reachable, or remove the container and rerun.`,
          );
        }
      } else {
        const found = lifecycle.containerServing(url);
        if (found) {
          id = validatedContainerIdentity(found.id, found.startedAt);
        }
      }
      if (!id) {
        // Last resort: the genesis hash is constant across deterministic boots
        // of the same image + env, so it cannot distinguish restarts.
        id = await genesisInstanceId(provider, url);
      }
    }

    if (evicted()) {
      return id;
    }
    if (probe.definitive) {
      return commit(key, id);
    }
    _instanceIdCache.set(key, {
      id,
      provisional: true,
    });
    return id;
  }

  // Called by the TRE lifecycle when it removes the container serving a url,
  // so a later boot on the same url resolves a fresh identity.
  function evictInstanceId(url) {
    for (const key of keysByUrl.get(url) ?? []) {
      _instanceIdCache.delete(key);
      _inflight.delete(key);
      _evictGen.set(key, (_evictGen.get(key) || 0) + 1);
    }
    keysByUrl.delete(url);
  }

  return { instanceId, evictInstanceId };
};
