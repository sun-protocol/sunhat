'use strict';

// Native endpoints share the configured path prefix, query and credentials.
function endpointUrl(source, endpoint = '') {
  const url = new URL(source);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('TRON network URL must use HTTP or HTTPS');
  }
  const root = url.pathname.replace(/\/jsonrpc\/?$/i, '').replace(/\/$/, '');
  url.pathname = root + '/' + endpoint.replace(/^\//, '');
  url.hash = '';
  return url;
}

function describeEndpoint(source) {
  try {
    const url = new URL(source);
    // Credentials can live in the path as well as userinfo and query fields.
    return `${url.protocol}//${url.host}`;
  } catch {
    return '<invalid TRON endpoint>';
  }
}

async function requestJson(source, endpoint, options = {}) {
  const provider = typeof source === 'string' ? undefined : source.fullNode;
  const url = endpointUrl(provider ? provider.host : source, endpoint);
  const headers = new Headers(provider?.headers);
  new Headers(options.headers).forEach((value, name) =>
    headers.set(name, value),
  );
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (url.username || url.password) {
    if (!headers.has('Authorization')) {
      const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
      headers.set(
        'Authorization',
        'Basic ' + Buffer.from(credentials).toString('base64'),
      );
    }
    url.username = '';
    url.password = '';
  }
  const timeout = provider?.timeout ?? 5000;
  const response = await fetch(url.href, {
    method: 'POST',
    ...options,
    redirect: 'error',
    headers,
    signal:
      options.signal ??
      (timeout === 0 ? undefined : AbortSignal.timeout(timeout)),
  });
  if (!response.ok) {
    const error = Object.assign(
      new Error(
        `TRON request to ${describeEndpoint(url.href)} failed with HTTP ${response.status}`,
      ),
      { status: response.status },
    );
    try {
      await response.body?.cancel();
    } catch (cleanupError) {
      try {
        console.error(
          'Failed to cancel TRON HTTP error response:',
          cleanupError,
        );
      } catch {
        // Preserve the HTTP failure even if cleanup diagnostics fail.
      }
    }
    throw error;
  }
  const { jsonParseBigSafe } = require('@openzeppelin/tron-runtime');
  return jsonParseBigSafe(await response.text());
}

function createHttpProvider(source, timeout = 300000, headers = {}) {
  const { HttpProvider } = require('tronweb').providers;
  class NativeHttpProvider extends HttpProvider {
    request(endpoint, payload = {}, method = 'get') {
      const url = endpointUrl(this.host, endpoint);
      const verb = method.toLowerCase();
      return this.instance
        .request({
          url: url.href,
          method: verb,
          data: verb === 'post' && Object.keys(payload).length ? payload : null,
          params: verb === 'get' ? payload : undefined,
          maxRedirects: 0,
        })
        .then(({ data }) => data);
    }
  }
  // Keep the configured URL intact; each request strips its RPC suffix once.
  const url = new URL(source);
  const authHeaders = new Headers(headers);
  if ((url.username || url.password) && !authHeaders.has('Authorization')) {
    const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    authHeaders.set(
      'Authorization',
      'Basic ' + Buffer.from(credentials).toString('base64'),
    );
  }
  url.username = '';
  url.password = '';
  return new NativeHttpProvider(
    url.href,
    timeout,
    '',
    '',
    Object.fromEntries(authHeaders),
  );
}

module.exports = {
  endpointUrl,
  describeEndpoint,
  requestJson,
  createHttpProvider,
};
