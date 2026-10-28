import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { errorMessage, toolchainError } from '../errors.js';

export function resolveExecutable(
  root: string,
  entry: string,
  tool: string,
): string {
  const path = resolve(root, entry);
  let directory: string;
  let executable: string;
  let isFile: boolean;
  try {
    directory = realpathSync(root);
    executable = realpathSync(path);
    isFile = statSync(executable).isFile();
  } catch (error) {
    return toolchainError(
      `cannot resolve ${tool} executable ${path}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  const location = relative(directory, executable);
  if (
    location === '..' ||
    location.startsWith(`..${sep}`) ||
    isAbsolute(location)
  ) {
    return toolchainError(
      `${tool} executable ${path} escapes ${directory}: ${executable}`,
    );
  }
  if (!isFile) {
    return toolchainError(`${tool} executable is not a file: ${path}`);
  }
  return executable;
}
