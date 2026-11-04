import { withConnection } from '../helpers/connection.js';

async function main(): Promise<void> {
  await withConnection(async (connection) => {
    const counter = await connection.ethers.deployContract('Counter');
    await counter.waitForDeployment();
    console.log(await counter.getAddress());
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
