import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
export const image =
  'tronbox/tre@sha256:f4332e11df12a9f360639a4546fd046593909630fda48af00b30410c144342f0';
export const compilerUrl =
  'https://raw.githubusercontent.com/tronprotocol/solc-bin/32695fe4b8d85704da9ec4cedce107a905e412ac/wasm/soljson-v0.8.26+commit.733b4d28.js';
export const compilerSha256 =
  '31fe546b9e6ad74e816d6406dcdb59f3af180f9c1145fd994bd5205d9c8465c1';
// Public first development key for hardhat-tron's deterministic TRE mnemonic.
export const privateKey =
  'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
    timeout: 45_000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    [result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n'),
  );
  return result;
}

export async function waitForNode(host) {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/wallet/getnodeinfo', host), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(2_000),
      });
      assert.equal(response.ok, true);
      const info = await response.json();
      assert.match(info.configNodeInfo.codeVersion, /^4\.8\.2/u);
      const block = await fetch(new URL('/wallet/getnowblock', host), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(2_000),
      });
      assert.equal(block.ok, true);
      const current = await block.json();
      assert.ok(current.block_header.raw_data.number >= 1);
      return info.configNodeInfo.codeVersion;
    } catch (error) {
      lastError = error;
    }
    await setTimeout(500);
  }
  throw new Error(`TRE did not become ready at ${host}`, { cause: lastError });
}
