import { network } from 'hardhat';
import type { NetworkConnection } from 'hardhat/types/network';

export async function withConnection<T>(
  action: (connection: NetworkConnection) => Promise<T>,
): Promise<T> {
  const connection = await network.create();
  let result: T;
  try {
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
