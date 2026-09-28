import type { NetworkConnection } from 'hardhat/types/network';
import type { HardhatEthers } from '@nomicfoundation/hardhat-ethers/types';
import type {
  DeploymentPlan,
  DeploymentReceipt,
  EvmDeploymentClient,
} from '../deploy/index.js';

export async function createHardhatEvmClient(
  connection: EthersNetworkConnection,
  networkName: string
): Promise<EvmDeploymentClient> {
  const provider = connection.ethers.provider;
  const [signer] = await connection.ethers.getSigners();
  if (signer === undefined) {
    throw new Error(`network ${networkName} has no deployment signer`);
  }
  const from = await signer.getAddress();
  return {
    async getNetworkIdentity() {
      const [network, genesis] = await Promise.all([
        provider.getNetwork(),
        provider.getBlock(0),
      ]);
      if (typeof genesis?.hash !== 'string') {
        throw new Error(`network ${networkName} did not return its genesis block`);
      }
      const isEphemeral = connection.networkConfig.type === 'edr-simulated';
      return {
        chainId: network.chainId.toString(),
        genesisHash: genesis.hash,
        ...(isEphemeral
          ? { instanceId: `edr:${process.pid}:${connection.id}` }
          : {}),
        name: networkName,
      };
    },
    async prepareDeployment(plan: DeploymentPlan) {
      const nonce = await signer.getNonce('pending');
      return {
        data: plan.initCode,
        from,
        method: 'create' as const,
        nonce: nonce.toString(),
        recoveryId: `${from}:${nonce}`,
        value: plan.value ?? '0',
      };
    },
    async broadcast(transaction) {
      const sent = await signer.sendTransaction({
        data: transaction.data,
        value: BigInt(transaction.value),
      });
      return { transactionId: sent.hash };
    },
    async getReceipt(
      transactionId: string,
      confirmations: number
    ): Promise<DeploymentReceipt> {
      const receipt = await provider.getTransactionReceipt(transactionId);
      if (receipt === null) {
        return {
          confirmations: 0,
          raw: { transactionId },
          status: 'pending',
          transactionId,
        };
      }
      const latestBlockNumber = await provider.getBlockNumber();
      const observedConfirmations = Math.max(
        0,
        latestBlockNumber - receipt.blockNumber + 1
      );
      return {
        address: receipt.contractAddress ?? undefined,
        blockHash: receipt.blockHash,
        blockNumber: receipt.blockNumber.toString(),
        confirmations: observedConfirmations,
        raw: {
          blockHash: receipt.blockHash,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
          transactionHash: receipt.hash,
        },
        status: receipt.status === 1 ? 'success' : 'failure',
        transactionId,
      };
    },
    async getCode(address: string) {
      const queriedBlockNumber = await provider.getBlockNumber();
      const [code, block] = await Promise.all([
        provider.getCode(address, queriedBlockNumber),
        provider.getBlock(queriedBlockNumber),
      ]);
      return {
        address,
        code,
        queriedBlockHash: block?.hash ?? undefined,
        queriedBlockNumber: queriedBlockNumber.toString(),
      };
    },
  };
}

export type EthersNetworkConnection = NetworkConnection & {
  readonly ethers: HardhatEthers;
};

export function hasHardhatEthers(
  connection: NetworkConnection
): connection is EthersNetworkConnection {
  return 'ethers' in connection && connection.ethers !== undefined;
}
