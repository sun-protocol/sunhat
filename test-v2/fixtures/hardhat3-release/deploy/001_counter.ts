import type { SunhatDeploymentContext } from '../../../../src/v2/deploy/index.js';

export default async function deployCounter({
  deploy,
}: SunhatDeploymentContext): Promise<void> {
  await deploy({
    constructorArguments: ['42'],
    fullyQualifiedName: 'contracts/Counter.sol:Counter',
  });
}
