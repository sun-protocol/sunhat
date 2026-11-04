import { AsyncLocalStorage } from 'node:async_hooks';
import core from '../../../vendor/hardhat-tron/index.js';
import type { LifecycleConfig } from '../../../vendor/hardhat-tron/index.js';
import type { TreConfig } from './types.js';
import { describeEndpoint } from '../../../vendor/hardhat-tron/runtime/transport.js';

export type TreTask = 'test' | 'compile' | 'node' | 'connection';
export const taskContext = new AsyncLocalStorage<TreTask>();
interface Lease {
  references: number;
  readonly identity: string;
  readonly lockKey: string;
  keepRunning: boolean;
}
export function createTreManager(lifecycle = core.createLifecycle()) {
  const leases = new Map<string, Lease>();
  const pending = new Map<string, Promise<unknown>>();

  async function serialized<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = pending.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    pending.set(key, current);
    try {
      return await current;
    } finally {
      if (pending.get(key) === current) {
        pending.delete(key);
      }
    }
  }

  async function acquireTre(
    config: TreConfig,
    url: string,
    httpHeaders: Record<string, string> = {},
  ): Promise<() => Promise<void>> {
    const endpoint = new URL(url);
    if (!['http:', 'https:'].includes(endpoint.protocol)) {
      throw new Error('TRON network URL must use HTTP or HTTPS');
    }
    const port = Number(
      endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80),
    );
    const settings: LifecycleConfig = {
      image: config.image,
      httpHeaders,
      port: config.port ?? port,
      startupEnv: config.startupEnv,
      readinessTimeoutMs: config.readinessTimeoutMs,
      keepRunning: config.keepRunning,
      ...(config.jarPath === undefined ? {} : { jarPath: config.jarPath }),
      ...(config.containerName === undefined
        ? {}
        : { containerName: config.containerName }),
    };
    if (config.port !== undefined && config.port !== port) {
      throw new Error('tre.port must match the selected TRON URL port');
    }
    const identity = JSON.stringify({
      image: settings.image,
      port: settings.port,
      startupEnv: settings.startupEnv,
      jarPath: settings.jarPath,
      containerName: settings.containerName,
    });
    const local = lifecycle.isLoopbackHost(endpoint.hostname);
    // Serialize potentially overlapping bindings without treating distinct
    // IPv4/IPv6 interfaces or remote endpoints as the same service.
    const lockKey = local ? `local:${port}` : endpoint.href;
    return serialized(lockKey, async () => {
      const task = taskContext.getStore() ?? 'connection';
      const policy =
        task === 'compile'
          ? config.autoStartOnCompile
          : task === 'test'
            ? config.autoStartOnTest
            : task === 'node'
              ? config.autoStartOnNode
              : false;
      let service: { spawned: boolean; name: string | null; id?: string };
      if (await lifecycle.isReachable(url, 2000, httpHeaders)) {
        service = { spawned: false, name: null };
      } else if (config.autoStart && policy) {
        if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) {
          throw new Error(
            'Automatic TRE startup requires an IPv4 loopback network URL',
          );
        }
        service = await lifecycle.ensureUp(settings, url, (message) =>
          console.error(`[sunhat-tron] ${message}`),
        );
      } else {
        throw new Error(
          `TRON node is not ready at ${describeEndpoint(url)}; start Docker TRE or enable the applicable tre.autoStart policy`,
        );
      }
      const discovered = service.spawned
        ? service
        : local
          ? lifecycle.containerServing(url)
          : undefined;
      const name = discovered?.name;
      const id = discovered?.id;
      if (!name || !id) {
        if (
          local &&
          lifecycle.hostMatchesBinding(endpoint.hostname, '127.0.0.1') &&
          [...leases.values()].some((lease) => lease.lockKey === lockKey)
        ) {
          throw new Error(
            'Cannot identify the TRE container for an active local binding',
          );
        }
        return async () => {};
      }
      let lease = leases.get(id);
      if (lease !== undefined && lease.identity !== identity) {
        throw new Error(
          'Conflicting TRE lifecycle configuration for an active container',
        );
      }
      if (lease === undefined) {
        if (!service.spawned) {
          return async () => {};
        }
        lease = { references: 0, identity, lockKey, keepRunning: false };
        leases.set(id, lease);
      }
      lifecycle.associateOwnedUrl(name, url);
      const selected = lease;
      selected.keepRunning ||= config.keepRunning || task === 'node';
      selected.references += 1;
      let released = false;
      return async () =>
        serialized(lockKey, async () => {
          if (released) {
            return;
          }
          released = true;
          selected.references -= 1;
          if (selected.references === 0) {
            if (!selected.keepRunning) {
              lifecycle.teardown(id);
              leases.delete(id);
            }
          }
        });
    });
  }

  return { acquire: acquireTre, lifecycle };
}
const manager = createTreManager();
export const acquireTre = manager.acquire;
export const treLifecycle = manager.lifecycle;
