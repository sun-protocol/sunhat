import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const releasesUrl = process.env.SUNHAT_TEST_PACKAGE_ROOT
  ? pathToFileURL(
      resolve(
        process.env.SUNHAT_TEST_PACKAGE_ROOT,
        'dist/toolchain/releases.js',
      ),
    ).href
  : new URL('../../dist/toolchain/releases.js', import.meta.url).href;

// Keep the production release names and binary mapping. Only replace the archive
// digest so installation can verify a small, locally generated archive offline.
export async function load(url, context, nextLoad) {
  if (url !== releasesUrl) {
    return nextLoad(url, context);
  }
  const digest = createHash('sha256')
    .update(readFileSync(process.env.SUNHAT_TEST_ARCHIVE))
    .digest('hex');
  return {
    format: 'module',
    shortCircuit: true,
    source: `
      import * as original from ${JSON.stringify(`${releasesUrl}?original`)};
      export const platformKey = original.platformKey;
      export const releaseUrl = original.releaseUrl;
      export function releaseFor(target, root) {
        return { ...original.releaseFor(target, root), sha256: ${JSON.stringify(digest)} };
      }
    `,
  };
}
