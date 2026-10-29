import { network } from 'hardhat';

async function main(): Promise<void> {
  const connection = await network.create();
  try {
    const counter = await connection.ethers.deployContract('Counter');
    await counter.waitForDeployment();
    console.log(await counter.getAddress());
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
