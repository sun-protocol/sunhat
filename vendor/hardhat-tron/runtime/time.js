'use strict';

// Adapted from @openzeppelin/hardhat-tron 0.1.0; see ../provenance.json and LICENSE.
module.exports = function createModule(deps) {
  // TVM-backed implementations of the block-and-time primitives that
  // tests reach for via `@nomicfoundation/hardhat-network-helpers`.
  // The connection exposes these as explicitly scoped helpers.
  //
  // All time-warp primitives are INSTANT — backed by
  // `tre_setNextBlockTimestamp` + `tre_mine` from the patched
  // `FullNode.jar`. There is no wall-clock fallback: stock
  // `tronbox/tre:dev` does not expose `tre_setNextBlockTimestamp`,
  // and a `tre_blockTime` + auto-mine wait-path would be 1:1
  // wall:chain — any non-trivial time-warp test (timelock expiry,
  // voting period, etc.) would then take real minutes/hours/days of
  // wall-clock. Configurations target the patched fork; if the
  // container doesn't have it, `_requireInstantWarp` throws with a
  // build-the-jar hint so tests fail fast and loud.
  //
  // What this exposes:
  //   * `mine(n)` / `mineUpTo(target)` — block-number primitives via
  //     `tre_mine` (n times). Instamine bt=0 required (tre_mine NPEs
  //     at bt!=0 in the stock image; the patched fork inherits the
  //     same requirement).
  //   * `latestBlock()` / `latest()` — read-only views backed by
  //     TronWeb's `getCurrentBlock`.
  //   * `increase(seconds)` / `increaseTo(target)` /
  //     `setNextBlockTimestamp(target)` — instant chain-time advance
  //     backed by `tre_setNextBlockTimestamp` + (optional) `tre_mine`.

  const { mine: tre_mine, rpcCall } = deps.cheatcodes;

  async function mine(tronWeb, blocks = 1) {
    const n = Number(blocks ?? 1);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw new Error(`mine: invalid block count ${blocks}`);
    }
    for (let i = 0; i < n; i++) {
      const r = await tre_mine(tronWeb);
      if (!r.supported) {
        throw new Error(`tre_mine failed: ${r.reason}`);
      }
    }
  }

  async function latestBlock(tronWeb) {
    const b = await tronWeb.trx.getCurrentBlock();
    // At genesis (block 0), java-tron's proto3 encoding omits the
    // zero-valued `number` field, so `raw_data.number` is `undefined`.
    // Coerce to 0 — block 0 is a valid height, and callers (ethers
    // `getBlockNumber`, `mineUpTo`, the time helpers) need a number, not
    // `undefined` (which propagates as `NaN` through arithmetic).
    return b.block_header.raw_data.number ?? 0;
  }

  async function latest(tronWeb) {
    const b = await tronWeb.trx.getCurrentBlock();
    // hardhat-network-helpers' `time.latest()` returns seconds; TronWeb
    // returns ms.
    return Math.floor(b.block_header.raw_data.timestamp / 1000);
  }

  async function mineUpTo(tronWeb, target) {
    const t = BigInt(target);
    const cur = BigInt(await latestBlock(tronWeb));
    if (t <= cur) {
      throw new Error(
        `mineUpTo: target ${t} must be greater than current block ${cur}`,
      );
    }
    await mine(tronWeb, Number(t - cur));
  }

  async function _requireInstantWarp(tronWeb) {
    if (!(await deps.capabilities.supportsPatched(tronWeb))) {
      throw new Error(
        'time-warp requires the patched FullNode.jar (tre_version with `-oz-tron` suffix). ' +
          'Build it via the docker pipeline and start a fresh container with the jar mounted. ' +
          'Stock tronbox/tre:dev does not expose `tre_setNextBlockTimestamp`; the wall-clock ' +
          'fallback was intentionally not included because multi-day warps would cost real ' +
          'wall-clock time and defeat the point.',
      );
    }
  }

  // Internal: set the override AND mine one block to seal it at
  // exactly `targetTs` seconds (Hardhat's `time.increaseTo` semantics).
  async function _warpAndMine(tronWeb, targetTs) {
    const targetMs = String(targetTs * 1000);
    const setResp = await rpcCall(tronWeb, 'tre_setNextBlockTimestamp', [
      targetMs,
    ]);
    if (setResp.error) {
      throw new Error(
        `tre_setNextBlockTimestamp failed: ${JSON.stringify(setResp.error)}`,
      );
    }
    const mineResp = await rpcCall(tronWeb, 'tre_mine', []);
    if (mineResp.error) {
      throw new Error(
        `tre_mine failed after warp: ${JSON.stringify(mineResp.error)}`,
      );
    }
  }

  async function increaseTo(tronWeb, target) {
    const targetTs = Number(target);
    if (!Number.isFinite(targetTs) || !Number.isInteger(targetTs)) {
      throw new Error(`increaseTo: invalid target ${target}`);
    }
    await _requireInstantWarp(tronWeb);
    // Skip the `latest()` precheck on the happy path — the server-side
    // `tre_setNextBlockTimestamp` rejects backward warps with a clear
    // error, so the precheck was a redundant RPC (~10-15 ms each) for a
    // case that almost never trips. With governance / timelock tests
    // doing dozens of warps per test, that's seconds per file. On
    // rejection we lazy-hydrate the more informative error message.
    try {
      return await _warpAndMine(tronWeb, targetTs);
    } catch (e) {
      if (/setNextBlockTimestamp/.test(e.message)) {
        const startTs = await latest(tronWeb).catch(() => null);
        if (startTs !== null && startTs !== undefined && targetTs <= startTs) {
          throw new Error(
            `increaseTo: target ${targetTs} must be greater than current ${startTs}`,
            { cause: e },
          );
        }
      }
      throw e;
    }
  }

  async function increase(tronWeb, seconds) {
    const delta = Number(seconds);
    if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta < 0) {
      throw new Error(`increase: invalid delta ${seconds}`);
    }
    if (delta === 0) {
      return latest(tronWeb);
    }
    // One `latest()` instead of two: compute target inline and return
    // it directly. We just sealed the block at exactly `target` seconds
    // via `_warpAndMine`, so a final `latest()` RPC would just confirm
    // what we already know.
    await _requireInstantWarp(tronWeb);
    const startTs = await latest(tronWeb);
    const target = startTs + delta;
    await _warpAndMine(tronWeb, target);
    return target;
  }

  // True hardhat-style setNextBlockTimestamp: ONLY sets the override
  // without mining. Caller's next state-changing tx (or explicit mine)
  // produces the block at the requested ts.
  async function setNextBlockTimestamp(tronWeb, target) {
    const targetTs = Number(target);
    const startTs = await latest(tronWeb);
    if (targetTs <= startTs) {
      throw new Error(
        `setNextBlockTimestamp: target ${targetTs} must be > current ${startTs}`,
      );
    }
    await _requireInstantWarp(tronWeb);
    const r = await rpcCall(tronWeb, 'tre_setNextBlockTimestamp', [
      String(targetTs * 1000),
    ]);
    if (r.error) {
      throw new Error(
        `tre_setNextBlockTimestamp failed: ${JSON.stringify(r.error)}`,
      );
    }
  }

  return {
    mine,
    mineUpTo,
    latest,
    latestBlock,
    increase,
    increaseTo,
    setNextBlockTimestamp,
  };
};
