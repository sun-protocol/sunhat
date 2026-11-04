'use strict';

// A failed probe is unknown, not evidence that the node lacks a capability.
module.exports = function createCapabilities({ rpcCall }) {
  let pending;
  async function supportsPatched(tronWeb) {
    if (pending === undefined) {
      pending = (async () => {
        const response = await rpcCall(tronWeb, 'tre_version', []);
        if (response?.error?.code === -32601) {
          return false;
        }
        if (
          response === null ||
          typeof response !== 'object' ||
          Array.isArray(response) ||
          response.error !== undefined ||
          typeof response.result !== 'string' ||
          response.result.length === 0
        ) {
          throw new Error('Invalid tre_version capability response', {
            cause: response,
          });
        }
        return /oz-tron/.test(response.result);
      })();
    }
    const selected = pending;
    try {
      return await selected;
    } catch (error) {
      if (pending === selected) {
        pending = undefined;
      }
      throw error;
    }
  }
  return { supportsPatched };
};
