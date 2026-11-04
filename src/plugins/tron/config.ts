import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConfigHooks } from 'hardhat/types/hooks';
import { isRecord } from '../../json.js';
import { configureTronCompiler } from './compiler.js';
import { normalizeTre } from './settings.js';

export default async (): Promise<Partial<ConfigHooks>> => ({
  async resolveUserConfig(user, resolver, next) {
    const defaultNetwork = user.networks?.default;
    let tre = normalizeTre(
      user.tre,
      defaultNetwork?.type === 'http' && defaultNetwork.tron === true
        ? 'tron'
        : 'evm',
    );
    const resolved = await next(user, resolver);
    if (
      tre.compiler.batchesPath !== undefined &&
      tre.compiler.batches.length === 0
    ) {
      const module: unknown = await import(
        pathToFileURL(resolve(resolved.paths.root, tre.compiler.batchesPath))
          .href
      );
      if (!isRecord(module) || !Array.isArray(module.default)) {
        throw new Error('tre.compiler.batchesPath must export an array');
      }
      tre = normalizeTre({
        ...tre,
        compiler: { ...tre.compiler, batches: module.default },
      });
    }
    if (tre.jarPath !== undefined) {
      tre.jarPath = resolve(resolved.paths.root, tre.jarPath);
    }
    resolved.tre = tre;
    for (const [name, network] of Object.entries(user.networks ?? {})) {
      if (
        'tron' in network &&
        network.tron !== undefined &&
        typeof network.tron !== 'boolean'
      ) {
        throw new Error(`networks.${name}.tron must be a boolean`);
      }
      if ('tron' in network && network.tron === true) {
        const target = resolved.networks[name];
        if (!target || target.type !== 'http') {
          throw new Error(`TRON network ${name} must use type http`);
        }
        target.tron = true;
      }
    }
    await configureTronCompiler(resolved, tre);
    return resolved;
  },
});
