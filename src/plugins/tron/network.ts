import type { NetworkHooks } from 'hardhat/types/hooks';
import type { NetworkConnection } from 'hardhat/types/network';
import core from '../../../vendor/hardhat-tron/index.js';
import { artifactsFor } from './artifacts.js';
import { normalizeTre } from './settings.js';
import { resolveSigningAccounts } from './accounts.js';
import { withCleanup } from './cleanup.js';
import { acquireTre, treLifecycle } from './resources.js';

export default async (): Promise<Partial<NetworkHooks>> => {
  const releases = new WeakMap<
    NetworkConnection<string>,
    () => Promise<void>
  >();
  const runtimes = new WeakMap<
    NetworkConnection<string>,
    ReturnType<typeof core.createRuntime>
  >();
  return {
    async newConnection(context, next) {
      let selectedContext = context;
      const evmPath = context.config.tre?.artifactPaths?.evm;
      if (evmPath !== undefined && evmPath !== context.config.paths.artifacts) {
        const artifacts = await artifactsFor(context, evmPath);
        // Hardhat hook contexts inherit HRE fields through their prototype.
        selectedContext = new Proxy(context, {
          get(target, property, receiver) {
            return property === 'artifacts'
              ? artifacts
              : Reflect.get(target, property, receiver);
          },
        });
      }
      const connection = await next(selectedContext);
      const network = connection.networkConfig;
      if (network.type !== 'http' || network.tron !== true) {
        return connection;
      }
      let release = async (): Promise<void> => {};
      try {
        const config = context.config.tre ?? normalizeTre(undefined);
        const url = await network.url.getUrl();
        const accounts = await resolveSigningAccounts(network.accounts);
        release = await acquireTre(config, url, network.httpHeaders);
        const runtime = core.createRuntime({
          lifecycle: treLifecycle,
          artifacts: await artifactsFor(
            context,
            config.artifactPaths?.tron ?? context.config.paths.artifacts,
          ),
          config: {
            paths: {
              root: context.config.paths.root,
              artifacts:
                config.artifactPaths?.tron ?? context.config.paths.artifacts,
            },
            tre: { fundSigners: config.fundSigners },
          },
          network: {
            name: connection.networkName,
            config: {
              tron: true,
              url,
              accounts,
              httpHeaders: network.httpHeaders,
              timeout: network.timeout,
            },
            provider: connection.provider,
          },
          ethers: connection.ethers,
        });
        Object.assign(connection.ethers, runtime.ethers);
        if (config.matchers) {
          core.registerMatchers();
        }
        connection.tre = runtime.tre;
        releases.set(connection, release);
        runtimes.set(connection, runtime);
        return connection;
      } catch (error) {
        await withCleanup(
          async () => {
            throw error;
          },
          async () => {
            await withCleanup(() => connection.close(), release);
          },
        );
        throw error;
      }
    },
    async onRequest(context, connection, request, next) {
      const runtime = runtimes.get(connection);
      if (runtime === undefined) {
        return next(context, connection, request);
      }
      if (
        request.method === 'hardhat_metadata' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(
          new URL(
            connection.networkConfig.type === 'http'
              ? await connection.networkConfig.url.getUrl()
              : 'http://invalid',
          ).hostname,
        )
      ) {
        const chainId = Number(
          (await connection.ethers.provider.getNetwork()).chainId,
        );
        if (!Number.isSafeInteger(chainId)) {
          throw new Error('TRON chain ID exceeds the metadata integer range');
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            clientVersion: 'sunhat-tron',
            chainId,
            instanceId: await runtime.tre.instanceId(),
          },
        };
      }
      const result = await runtime.request(request, async (args) => {
        const response = await next(context, connection, {
          ...request,
          ...args,
        });
        if ('error' in response) {
          throw Object.assign(
            new Error(response.error.message),
            response.error,
            { cause: response.error },
          );
        }
        return response.result;
      });
      return { jsonrpc: '2.0', id: request.id, result };
    },
    async closeConnection(context, connection, next) {
      const release = releases.get(connection);
      releases.delete(connection);
      runtimes.delete(connection);
      await withCleanup(
        () => next(context, connection),
        release ?? (async () => {}),
      );
    },
  };
};
