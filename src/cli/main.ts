#!/usr/bin/env node
import { parse } from './parser.js';
import { route } from './router.js';
import { CliError, errorMessage, toolchainError } from '../errors.js';
import { isSupportedNode, nodeSupportDescription } from '../runtime.js';

try {
  if (!isSupportedNode(process.versions.node)) {
    toolchainError(
      `Sunhat requires Node.js ${nodeSupportDescription()}; resolved ${process.versions.node}`,
    );
  }
  process.exitCode = await route(parse(process.argv.slice(2)));
} catch (error) {
  if (error instanceof CliError) {
    process.stderr.write(`sunhat: ${error.message}\n`);
    process.exitCode = error.exitCode;
  } else {
    process.stderr.write(`sunhat: ${errorMessage(error)}\n`);
    process.exitCode = 6;
  }
}
