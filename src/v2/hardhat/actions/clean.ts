import type { NewTaskActionFunction } from 'hardhat/types/tasks';
import { cleanSunhatProject } from '../../clean/index.js';

const cleanAction: NewTaskActionFunction = async (_arguments, hre) => {
  const result = await cleanSunhatProject(hre.config.paths.root);
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

export default cleanAction;
