import { toolchainError } from '../errors.js';

export async function downloadArchive(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    return toolchainError(`download failed (${response.status}): ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
