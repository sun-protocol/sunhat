import type { P4DeploymentContext } from "../src/p4-deploy-task-action.js";

export default async function deployP2Counter({
  deploy,
}: P4DeploymentContext): Promise<void> {
  await deploy({
    constructorArguments: [42n.toString()],
    fullyQualifiedName: "p2-contracts/P2Counter.sol:P2Counter",
  });
}
