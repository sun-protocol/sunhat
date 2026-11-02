import { AsyncLocalStorage } from 'node:async_hooks';
import core from '../../../vendor/hardhat-tron/index.js';
import type { LifecycleConfig } from '../../../vendor/hardhat-tron/index.js';
import type { TreConfig } from './types.js';

export type TreTask = 'test' | 'compile' | 'node' | 'connection';
export const taskContext = new AsyncLocalStorage<TreTask>();
interface Lease {
  references: number;
  readonly identity: string;
  readonly ready: Promise<{ spawned: boolean; name: string | null }>;
  keepRunning: boolean;
}
export function createTreManager(lifecycle = core.createLifecycle()) {
  const leases = new Map<string, Lease>();

  async function acquireTre(
    config: TreConfig,
    url: string,
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
    let lease = leases.get(url);
    if (lease !== undefined && lease.identity !== identity) {
      throw new Error(
        'Conflicting TRE lifecycle configuration for an active network URL',
      );
    }
    if (lease === undefined) {
      const ready = (async () => {
        const task = taskContext.getStore() ?? 'connection';
        const policy =
          task === 'compile'
            ? config.autoStartOnCompile
            : task === 'test'
              ? config.autoStartOnTest
              : task === 'node'
                ? config.autoStartOnNode
                : false;
        if (config.autoStart && policy) {
          if (
            !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
          ) {
            throw new Error(
              'Automatic TRE startup requires a loopback network URL',
            );
          }
          return lifecycle.ensureUp(settings, url, (message) =>
            console.error(`[sunhat-tron] ${message}`),
          );
        }
        if (!(await lifecycle.isReachable(url))) {
          throw new Error(
            `TRON node is not ready at ${url}; start Docker TRE or enable the applicable tre.autoStart policy`,
          );
        }
        return { spawned: false, name: null };
      })();
      lease = {
        references: 0,
        identity,
        ready,
        keepRunning: config.keepRunning || taskContext.getStore() === 'node',
      };
      leases.set(url, lease);
    }
    const selected = lease;
    selected.keepRunning ||=
      config.keepRunning || taskContext.getStore() === 'node';
    selected.references += 1;
    let service: { spawned: boolean; name: string | null };
    try {
      service = await selected.ready;
    } catch (error) {
      selected.references -= 1;
      if (leases.get(url) === selected) {
        leases.delete(url);
      }
      throw error;
    }
    let released = false;
    return async () => {
      if (released) {
        return;
      }
      released = true;
      selected.references -= 1;
      if (selected.references === 0) {
        if (service.spawned && !selected.keepRunning) {
          lifecycle.teardown(service.name);
        }
        leases.delete(url);
      }
    };
  }

  return { acquire: acquireTre };
}
const manager = createTreManager();
export const acquireTre = manager.acquire;

export async function withCleanup<T>(
  action: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let result: T;
  try {
    result = await action();
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      try {
        console.error('TRON cleanup failed:', cleanupError);
      } catch {
        /* Preserve the primary thrown value. */
      }
    }
    throw error;
  }
  await cleanup();
  return result;
}
