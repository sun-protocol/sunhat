'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule(deps) {
  // Docker lifecycle for the TRE container. Single-container case
  // only — multi-worker parallel test orchestration stays out of this
  // package; consumers that need it manage their own containers and
  // point each worker at its own `TRE_URL`, and the auto-up gate
  // detects "something already listening" and skips spawning.
  //
  // What this does:
  //   * isReachable(url)        -- JSON-RPC tre_version probe, 2s timeout
  //   * ensureUp(cfg, log)      -- docker run + wait-for-ready
  //   * teardown(name)          -- docker rm -f
  //   * containerState(name)    -- stopped-leftover detection in ensureUp
  //
  // Container layout mirrors `docker run -d -p 9090:9090 tronbox/tre:dev`:
  //   image:     tronbox/tre:dev (or whatever cfg.image is)
  //   env:       deterministic accounts derived from the standard test
  //              mnemonic, identical on every machine
  //   port:      cfg.port:9090 (TVM container always exposes 9090
  //              internally; we map to a host port)
  //   bind:      optional cfg.jarPath -> /tron/FullNode/FullNode.jar
  //   JVM tune:  G1GC + 20ms pause target. NOT cosmetic -- the
  //              snapshot/revert path allocates large LinkedHashMaps
  //              that, under ParallelGC, surface as multi-hundred-ms
  //              STW pauses that drop the HTTP keep-alive socket and
  //              fail axios mid-test. Same config as that docker run
  //              invocation.
  //

  const { spawnSync: spawnCommand } =
    deps.process ?? require('node:child_process');
  const spawnSync = (command, args, options = {}) =>
    spawnCommand(command, args, { timeout: 30000, ...options });
  const path = require('node:path');
  const fs = require('node:fs');

  function defaultContainerName() {
    return `hardhat-tron-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // Containers this process launched (docker run), keyed by the network url
  // they answer on. Populated by ensureUp on the spawn path and
  // cleared by teardown. Consumers derive a per-instance identity from the
  // container itself (see runtime/instance-id.js) directly for containers we
  // own; a TRE we merely found already reachable (spawned=false) is not
  // recorded here, but is still identified via containerServing (tier 2) or the
  // node's own tre_instanceId (tier 0) -- the chain-derived genesis hash is
  // only the last resort when neither of those applies.
  const _launched = new Map();

  function launchedContainerFor(networkUrl) {
    return _launched.get(networkUrl);
  }

  // Test-only: manipulate launched-container ownership without booting docker.
  function _setLaunchedForTests(url, name) {
    _launched.set(url, name);
  }
  function _forgetLaunchedForTests(url) {
    _launched.delete(url);
  }

  // True when the host denotes this machine's loopback interface. A url that
  // resolves elsewhere cannot be identified through the local docker daemon.
  function isLoopbackHost(host) {
    return (
      host === 'localhost' ||
      host === '::1' ||
      host === '[::1]' ||
      host === '0.0.0.0' ||
      host === '::' ||
      host === '[::]' ||
      /^127\./.test(host)
    );
  }

  // The TRE's fixed container-side port; the plugin always publishes
  // `127.0.0.1:<hostPort>:9090`. Requiring the matched binding to sit on this
  // exact container port fingerprints the node and excludes port-forwarder
  // containers (a socat republishing 9614->9614 in front of a TRE was otherwise
  // discovered instead of the node, and its id survived a node swap). Residual:
  // a crafted forwarder that itself uses 9090 internally still matches — only
  // tier 0 (the node-served tre_instanceId) is forwarder-proof.
  const TRE_CONTAINER_PORT = '9090/tcp';

  // Node's URL.hostname keeps IPv6 hosts bracketed ('[::1]') while docker's
  // HostIp carries none ('::1') — strip before comparing.
  function stripBrackets(host) {
    return host.startsWith('[') && host.endsWith(']')
      ? host.slice(1, -1)
      : host;
  }

  // Pure host-matching rule for one docker port binding. A binding matches when
  // its HostIp is a wildcard ('', '0.0.0.0', '::' — bound on every interface),
  // or, for the "unspecified" url hosts (localhost / 0.0.0.0 / ::) that name no
  // concrete interface, when it sits on any loopback address. A literal url
  // host (127.x.x.x, ::1) must equal the HostIp exactly: host ports are only
  // exclusive within IPv4 on a single interface — 127.0.0.1/.2/.3 and [::1] can
  // each carry a different container on the same port — so anything looser
  // collapses distinct instances or misattributes across address families.
  function hostMatchesBinding(urlHost, hostIp) {
    const host = stripBrackets(urlHost);
    const ip = stripBrackets(hostIp || '');
    if (ip === '' || ip === '0.0.0.0' || ip === '::') {
      return true;
    }
    if (host === 'localhost' || host === '0.0.0.0' || host === '::') {
      return ip === '::1' || /^127\./.test(ip);
    }
    return ip === host;
  }

  // True when a docker inspect Ports map binds the given host port for the
  // given url host on the TRE's fixed container port — bindings on any other
  // container-side port belong to some other service (see TRE_CONTAINER_PORT).
  function bindsHostPort(portsJson, hostPort, urlHost) {
    for (const b of (portsJson || {})[TRE_CONTAINER_PORT] || []) {
      if (
        b &&
        b.HostPort === String(hostPort) &&
        hostMatchesBinding(urlHost, b.HostIp)
      ) {
        return true;
      }
    }
    return false;
  }

  // Choose the single container whose published bindings match the url's host
  // and port, from `docker inspect` lines `id|startedAt|name|portsJson`. More
  // than one match (only reachable for unspecified url hosts like `localhost`
  // with multiple same-port loopback bindings) throws: falling back to the
  // genesis id would give two different TREs one shared manifest.
  function selectServingMatch(inspectLines, port, host, networkUrl) {
    const matches = [];
    for (const line of inspectLines) {
      const parts = line.split('|');
      if (parts.length < 4) {
        continue;
      }
      const [id, startedAt, rawName] = parts;
      let ports;
      try {
        // Rejoin in case the ports JSON itself contained a '|'.
        ports = JSON.parse(parts.slice(3).join('|'));
      } catch {
        continue;
      }
      if (id && startedAt && bindsHostPort(ports, port, host)) {
        matches.push({ id, startedAt, name: rawName.replace(/^\//, '') });
      }
    }
    if (matches.length > 1) {
      throw new Error(
        `[hardhat-tron] multiple containers publish port ${port} for ${networkUrl}: ` +
          matches.map((m) => `${m.name} (${m.id.slice(0, 12)})`).join(', ') +
          `. Cannot attribute the node to one of them; point the network url at the container's ` +
          `exact loopback address (e.g. http://127.0.0.1:${port}) or stop the containers you are not using.`,
      );
    }
    return matches.length === 1 ? matches[0] : undefined;
  }

  // Identify the running container serving a loopback url. Host ports are NOT
  // exclusive per docker daemon — only within IPv4 on one interface — so the
  // `docker ps --filter publish=` candidates (a filter that is also blind to
  // IPv6-only bindings on Docker Desktop) are narrowed by exact host matching
  // plus the TRE container-port fingerprint (see hostMatchesBinding /
  // bindsHostPort). Returns { id, startedAt } or undefined (no docker,
  // non-loopback, remote DOCKER_HOST, or no match); throws when the match is
  // ambiguous rather than falling back to an id that cannot tell the
  // candidates apart.
  function containerServing(networkUrl) {
    let host;
    let port;
    try {
      const u = new URL(networkUrl);
      host = u.hostname;
      port = u.port || '9090';
    } catch {
      return undefined;
    }
    if (!isLoopbackHost(host)) {
      return undefined;
    }
    const dockerHost = process.env.DOCKER_HOST || '';
    if (dockerHost && !/^(unix:|npipe:)/.test(dockerHost)) {
      return undefined;
    }

    const ps = spawnSync(
      'docker',
      ['ps', '--filter', `publish=${port}`, '--format', '{{.ID}}'],
      { encoding: 'utf8' },
    );
    if (ps.status !== 0) {
      return undefined;
    }
    const ids = (ps.stdout || '').trim().split('\n').filter(Boolean);
    if (ids.length === 0) {
      return undefined;
    }

    const ins = spawnSync(
      'docker',
      [
        'inspect',
        '--format',
        '{{.Id}}|{{.State.StartedAt}}|{{.Name}}|{{json .NetworkSettings.Ports}}',
        ...ids,
      ],
      { encoding: 'utf8' },
    );
    if (ins.status !== 0) {
      return undefined;
    }

    return selectServingMatch(
      (ins.stdout || '').trim().split('\n'),
      port,
      host,
      networkUrl,
    );
  }

  // Whether the url denotes a local TRE — a container this process launched or
  // a loopback address — as opposed to a public TVM network (nile, shasta,
  // mainnet), whose configs also carry `tron: true`.
  function isLocalTre(networkUrl) {
    if (_launched.has(networkUrl)) {
      return true;
    }
    try {
      return isLoopbackHost(new URL(networkUrl).hostname);
    } catch {
      return false;
    }
  }

  async function isReachable(networkUrl, timeoutMs = 2000) {
    const root = networkUrl.replace(/\/jsonrpc\/?$/, '').replace(/\/$/, '');
    try {
      const response = await fetch(root + '/wallet/getnodeinfo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        return false;
      }
      const info = await response.json();
      if (typeof info?.configNodeInfo?.codeVersion !== 'string') {
        return false;
      }
      const blockResponse = await fetch(root + '/wallet/getnowblock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!blockResponse.ok) {
        return false;
      }
      const block = await blockResponse.json();
      return (
        Number.isSafeInteger(block?.block_header?.raw_data?.number) &&
        block.block_header.raw_data.number >= 1
      );
    } catch {
      return false;
    }
  }

  // 'running' | 'stopped' | undefined (no such container, or docker unavailable).
  function containerState(name) {
    const r = spawnSync(
      'docker',
      ['inspect', '--format', '{{.State.Running}}', name],
      { encoding: 'utf8', timeout: 120000 },
    );
    if (r.status !== 0) {
      return undefined;
    }
    return r.stdout.trim() === 'true' ? 'running' : 'stopped';
  }

  // JVM tuning string -- required for snapshot/revert stability. See
  // the header comment for why ParallelGC is unsafe under our workload.
  const JAVA_TOOL_OPTIONS =
    '-XX:+UseG1GC -XX:MaxGCPauseMillis=20 -Xmx2g -Xms512m -XX:+AlwaysPreTouch -XX:+TieredCompilation';

  function buildRunArgs(cfg, name) {
    const args = [
      'run',
      '-d',
      '--name',
      name,
      '-p',
      `127.0.0.1:${cfg.port}:9090`,
    ];

    const env = {
      accounts: '10',
      defaultBalance: '1000000000',
      mnemonic: 'test test test test test test test test test test test junk',
      hdPath: "m/44'/60'/0'/0",
      quiet: 'true',
      JAVA_TOOL_OPTIONS,
      ...cfg.startupEnv,
    };
    for (const [k, v] of Object.entries(env)) {
      args.push('-e', `${k}=${v}`);
    }

    // Optional patched-jar bind mount. We only attach if the file
    // actually exists -- a missing path is a user config error and
    // surfaces clearly via docker, but a stale path on a teammate's
    // machine (e.g. the jar was deleted) should NOT silently fall back
    // to the stock image. So: if jarPath is set, require it to exist.
    if (cfg.jarPath) {
      const abs = path.isAbsolute(cfg.jarPath)
        ? cfg.jarPath
        : path.resolve(process.cwd(), cfg.jarPath);
      if (!fs.existsSync(abs)) {
        throw new Error(
          `tre.jarPath points at a file that does not exist: ${abs}`,
        );
      }
      args.push('-v', `${abs}:/tron/FullNode/FullNode.jar:ro`);
    }

    args.push('--restart', 'no', cfg.image);
    return args;
  }

  async function waitForReady(url, deadlineMs, log) {
    const start = Date.now();
    const lastErr = null;
    while (Date.now() - start < deadlineMs) {
      if (await isReachable(url)) {
        log(`  TRE ready in ${Math.floor((Date.now() - start) / 1000)}s`);
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
      `TRE did not become ready at ${url} within ${deadlineMs}ms (last: ${lastErr})`,
    );
  }

  // Returns { spawned, name, url }. spawned=false means we re-used an
  // existing reachable container (or a manually-started one).
  async function ensureUp(cfg, networkUrl, log = () => {}) {
    if (await isReachable(networkUrl)) {
      log(`  TRE already reachable at ${networkUrl} (skipping spawn)`);
      // We didn't spawn it, but a parallel-test runner (own container + TRE_URL)
      // or a manual `tre:up` may have left the chain at genesis (block 0), where
      // java-tron's proto3 omits the zero `number` field and the first
      // CreateSmartContract deploy crashes in getCurrentRefBlockParams. Prime it
      // the same way as the spawn path. Best-effort + idempotent: on an
      // already-advanced chain this just mines one extra (harmless) block.
      return { spawned: false, name: null, url: networkUrl };
    }

    const name = cfg.containerName || defaultContainerName();

    // TRE containers are single-boot by construction: the image entrypoint
    // appends a closing '}' to fullnode.conf on every start, so a restarted
    // container always dies seconds later on a config parse error while
    // `docker start` reports success. A stopped leftover under this name
    // (e.g. from a prior `keepRunning: true` run) is therefore unusable —
    // remove it and run fresh instead of restarting it. A running container
    // that merely failed the reachability probe (e.g. a sibling process's node
    // still booting) is never removed: the state check skips it, and the
    // non-forced `docker rm` refuses atomically if it was started in the
    // check-to-remove window — the `docker run` below then fails loudly on
    // the name conflict instead of silently killing it.
    log(`  spawning ${cfg.image} as ${name} on port ${cfg.port}`);
    const args = buildRunArgs(cfg, name);
    const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) {
      throw new Error(
        `docker run failed: ${r.error?.message ?? r.stderr?.trim() ?? r.stdout?.trim() ?? r.status}`,
        { cause: r.error },
      );
    }

    _launched.set(networkUrl, name);
    try {
      await waitForReady(networkUrl, cfg.readinessTimeoutMs, log);
    } catch (error) {
      if (!cfg.keepRunning) {
        try {
          teardown(name, log);
        } catch (cleanupError) {
          try {
            console.error(
              'Failed to remove owned TRE container:',
              cleanupError,
            );
          } catch {
            /* Preserve the original failure when diagnostics also fail. */
          }
        }
      }
      throw error;
    }

    return { spawned: true, name, url: networkUrl };
  }

  function teardown(name, log = () => {}) {
    if (!name || ![..._launched.values()].includes(name)) {
      return;
    }
    log(`  tearing down ${name}`);
    const removed = spawnSync('docker', ['rm', '-f', name], {
      encoding: 'utf8',
    });
    if (
      removed.status !== 0 &&
      !removed.stderr?.includes('No such container')
    ) {
      throw new Error(
        `Could not remove owned TRE container ${name}: ${removed.error?.message ?? removed.stderr}`,
      );
    }
    for (const [url, ownedName] of _launched) {
      if (ownedName === name) {
        _launched.delete(url);
        deps.instanceIds.evictInstanceId(url);
      }
    }
  }

  return {
    ensureUp,
    teardown,
    isReachable,
    containerState,
    launchedContainerFor,
    isLocalTre,
    isLoopbackHost,
    hostMatchesBinding,
    bindsHostPort,
    selectServingMatch,
    containerServing,
    _setLaunchedForTests,
    _forgetLaunchedForTests,
  };
};
