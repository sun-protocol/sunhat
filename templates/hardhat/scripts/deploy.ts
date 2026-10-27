import { ethers } from "hardhat";

async function main(): Promise<void> {
  const counter = await ethers.deployContract("Counter");
  await counter.waitForDeployment();
  console.log(await counter.getAddress());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
