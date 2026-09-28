import type { HookContext, NetworkHooks } from "hardhat/types/hooks";
import type { ChainType, NetworkConnection } from "hardhat/types/network";
import { ProbeManager } from "./probe-manager.js";

const managers = new WeakMap<object, ProbeManager>();

export default async (): Promise<Partial<NetworkHooks>> => ({
  async newConnection<ChainTypeT extends ChainType | string>(
    context: HookContext,
    next: (
      nextContext: HookContext,
    ) => Promise<NetworkConnection<ChainTypeT>>,
  ): Promise<NetworkConnection<ChainTypeT>> {
    const connection = await next(context);
    const manager = new ProbeManager(connection.id);
    managers.set(connection, manager);
    Object.defineProperty(connection, "sunhatProbe", {
      configurable: false,
      enumerable: true,
      value: manager,
      writable: false,
    });
    return connection;
  },
});
