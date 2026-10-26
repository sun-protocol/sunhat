import { writeFileSync } from 'node:fs';

// Keep install tests offline while exercising the CLI's real download handling.
globalThis.fetch = async (url) => {
  writeFileSync(process.env.SUNHAT_TEST_DOWNLOAD_LOG, String(url));
  if (process.env.SUNHAT_TEST_DOWNLOAD === 'http-error') return new Response(null, { status: 503 });
  return new Response('invalid toolchain archive', { status: 200 });
};
