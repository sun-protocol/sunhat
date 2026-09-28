import type {
  BroadcastResult,
  DeploymentPlan,
  DeploymentReceipt,
  DeploymentTransaction,
  NetworkAdapter,
  NetworkIdentity,
  OnchainCode,
} from './types.js';

/**
 * TVM-specific client surface. Resource and amount values remain decimal
 * strings, so SUN, Energy, and Bandwidth are never downcast to JavaScript
 * numbers or confused with EVM gas fields.
 */
export interface TronDeploymentClient {
  getNetworkIdentity(): Promise<Omit<NetworkIdentity, 'chain'>>;
  prepareDeployment(plan: DeploymentPlan): Promise<DeploymentTransaction>;
  broadcast(transaction: DeploymentTransaction): Promise<BroadcastResult>;
  getReceipt(
    transactionId: string,
    confirmations: number
  ): Promise<DeploymentReceipt>;
  getCode(address: string): Promise<string | OnchainCode>;
}

/** Standalone TRON adapter; it deliberately does not inherit ethers Provider. */
export class TronAdapter implements NetworkAdapter {
  public readonly chain = 'tron' as const;
  readonly #client: TronDeploymentClient;

  public constructor(client: TronDeploymentClient) {
    this.#client = client;
  }

  public async getNetworkIdentity(): Promise<NetworkIdentity> {
    return { ...(await this.#client.getNetworkIdentity()), chain: 'tron' };
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
    const result = await this.#client.getCode(address);
    return typeof result === 'string' ? { address, code: result } : result;
  }
}
