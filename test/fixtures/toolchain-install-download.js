import { readFileSync, writeFileSync } from 'node:fs';

globalThis.fetch = async (url) => {
  if (process.env.SUNHAT_TEST_DOWNLOAD_LOG) {
    writeFileSync(process.env.SUNHAT_TEST_DOWNLOAD_LOG, String(url));
  }
  return new Response(readFileSync(process.env.SUNHAT_TEST_ARCHIVE));
};
