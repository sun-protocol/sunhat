const version = process.env.SUNHAT_TEST_NODE_VERSION;
if (!version) {
  throw new Error('SUNHAT_TEST_NODE_VERSION is required');
}
Object.defineProperty(process.versions, 'node', { value: version });
