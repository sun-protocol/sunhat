import { readFileSync, writeFileSync } from 'node:fs';

const nativeFetch = globalThis.fetch;

globalThis.fetch = async (url, options) => {
  if (process.env.SUNHAT_TEST_DOWNLOAD_LOG) {
    writeFileSync(process.env.SUNHAT_TEST_DOWNLOAD_LOG, String(url));
  }
  if (process.env.SUNHAT_TEST_DOWNLOAD_URL) {
    return nativeFetch(process.env.SUNHAT_TEST_DOWNLOAD_URL, options);
  }
  return new Response(readFileSync(process.env.SUNHAT_TEST_ARCHIVE));
};
