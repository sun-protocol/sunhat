import type { NetworkConnection } from 'hardhat/types/network';
import 'sunhat/hardhat3-tron';

export async function inspectTron(
  connection: NetworkConnection,
): Promise<string> {
  if (connection.tre === undefined) {
    throw new Error('A TRON connection is required');
  }
  const contract = await connection.ethers.deployContract('Counter');
  await contract.waitForDeployment();
  const receipt = await (await contract.increment()).wait();
  if (receipt?.nativeTransactionId === undefined) {
    throw new Error('Native receipt is required');
  }
  await connection.tre.helpers.time.latest();
  return receipt.nativeTransactionId;
}
