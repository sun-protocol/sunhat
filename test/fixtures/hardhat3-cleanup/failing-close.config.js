import config from './hardhat.config.ts';

const failingClose = {
  id: 'sunhat-test-close-failure',
  hookHandlers: {
    network: async () => ({
      default: async () => ({
        closeConnection: async (context, connection, next) => {
          await next(context, connection);
          throw new Error('EXPECTED_CLOSE_FAILURE');
        },
      }),
    }),
  },
};

export default {
  ...config,
  plugins: [...config.plugins, failingClose],
};
