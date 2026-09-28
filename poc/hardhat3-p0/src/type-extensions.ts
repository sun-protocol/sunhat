import type { ProbeManager } from "./probe-manager.js";

declare module "hardhat/types/network" {
  interface NetworkConnection {
    /** Connection-scoped state installed by the P0 Sunhat plugin probe. */
    readonly sunhatProbe: ProbeManager;
  }
}
