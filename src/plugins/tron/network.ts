import type { NetworkHooks } from 'hardhat/types/hooks';
import type { NetworkConnection } from 'hardhat/types/network';
import { HDNodeWallet, SigningKey } from 'ethers';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import type { ArtifactManager } from 'hardhat/types/artifacts';
import core from '../../../vendor/hardhat-tron/index.js';
import { normalizeTre } from './config.js';
import { acquireTre, withCleanup } from './resources.js';

export default async (): Promise<Partial<NetworkHooks>> => {
  const releases = new WeakMap<
    NetworkConnection<string>,
    () => Promise<void>
  >();
  const runtimes = new WeakMap<
    NetworkConnection<string>,
    ReturnType<typeof core.createRuntime>
  >();
  const artifactManagers = new Map<string, Promise<ArtifactManager>>();
  return {
    async newConnection(context, next) {
      let selectedContext = context;
      const evmPath = context.config.tre?.artifactPaths?.evm;
      if (evmPath !== undefined && evmPath !== context.config.paths.artifacts) {
        let pending = artifactManagers.get(evmPath);
        if (pending === undefined) {
          pending = createHardhatRuntimeEnvironment(
            { paths: { artifacts: evmPath } },
            {},
            context.config.paths.root,
          ).then((hre) => hre.artifacts);
          artifactManagers.set(evmPath, pending);
        }
        selectedContext = { ...context, artifacts: await pending };
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
        const accounts: string[] = [];
        if (network.accounts === 'remote') {
          // Native writes require local keys; remote accounts remain read-only.
        } else if (Array.isArray(network.accounts)) {
          for (const account of network.accounts) {
            accounts.push(await account.getHexString());
          }
        } else {
          const mnemonic = await network.accounts.mnemonic.get();
          const passphrase = await network.accounts.passphrase.get();
          for (let index = 0; index < network.accounts.count; index += 1) {
            accounts.push(
              HDNodeWallet.fromPhrase(
                mnemonic,
                passphrase,
                `${network.accounts.path}/${network.accounts.initialIndex + index}`,
              ).privateKey,
            );
          }
        }
        for (const key of accounts) {
          if (!/^0x[a-fA-F0-9]{64}$/u.test(key)) {
            throw new Error('Invalid TRON signing account format');
          }
          try {
            void new SigningKey(key).publicKey;
          } catch {
            throw new Error('Invalid TRON signing account');
          }
        }
        release = await acquireTre(config, url);
        const runtime = core.createRuntime({
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
            config: { tron: true, url, accounts },
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
