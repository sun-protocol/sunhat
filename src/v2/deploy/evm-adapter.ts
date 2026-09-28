import type {
  BroadcastResult,
  DeploymentPlan,
  DeploymentReceipt,
  DeploymentTransaction,
  NetworkAdapter,
  NetworkIdentity,
  OnchainCode,
} from './types.js';

/** Public EVM client surface used by the deployment adapter. */
export interface EvmDeploymentClient {
  getNetworkIdentity(): Promise<Omit<NetworkIdentity, 'chain'>>;
  prepareDeployment(plan: DeploymentPlan): Promise<DeploymentTransaction>;
  broadcast(transaction: DeploymentTransaction): Promise<BroadcastResult>;
  getReceipt(
    transactionId: string,
    confirmations: number
  ): Promise<DeploymentReceipt>;
  getCode(address: string): Promise<string>;
}

/**
 * EVM adapter with no dependency on Hardhat internals. A Hardhat 3 connection
 * can supply this client through its public provider or ethers integration.
 */
export class EvmAdapter implements NetworkAdapter {
  public readonly chain = 'evm' as const;
  readonly #client: EvmDeploymentClient;

  public constructor(client: EvmDeploymentClient) {
    this.#client = client;
  }

  public async getNetworkIdentity(): Promise<NetworkIdentity> {
    return { ...(await this.#client.getNetworkIdentity()), chain: 'evm' };
  }

  public prepareDeployment(plan: DeploymentPlan): Promise<DeploymentTransaction> {
    return this.#client.prepareDeployment(plan);
  }

  public broadcast(transaction: DeploymentTransaction): Promise<BroadcastResult> {
    return this.#client.broadcast(transaction);
  }

  public getReceipt(
    transactionId: string,
    confirmations: number
  ): Promise<DeploymentReceipt> {
    return this.#client.getReceipt(transactionId, confirmations);
  }

  public async getCode(address: string): Promise<OnchainCode> {
    return { address, code: await this.#client.getCode(address) };
  }
}
