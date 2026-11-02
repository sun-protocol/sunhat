import { network } from 'hardhat';
import type { NetworkConnection } from 'hardhat/types/network';

export async function withConnection<T>(
  action: (connection: NetworkConnection) => Promise<T>,
): Promise<T> {
  const connection = await network.create();
  let result: T;
  try {
    if (connection.tre === undefined) {
      throw new Error(
        'The TRON template requires a TRON connection; select a network with tron: true',
      );
    }
    result = await action(connection);
  } catch (error) {
    try {
      await connection.close();
    } catch (cleanupError) {
      try {
        console.error(
          'Failed to close Hardhat network connection:',
          cleanupError,
        );
      } catch {
        // A broken diagnostic sink must not replace the original exception.
      }
    }
    throw error;
  }
  await connection.close();
  return result;
}
