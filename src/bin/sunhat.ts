#!/usr/bin/env node
import { parse } from '../cli/parser.js';
import { route } from '../cli/router.js';
import { CliError } from '../errors.js';
try {
  process.exitCode = await route(parse(process.argv.slice(2)));
} catch (error) {
  if (error instanceof CliError) {
    process.stderr.write(`sunhat: ${error.message}\n`);
    process.exitCode = error.exitCode;
  } else {
    process.stderr.write(
      `sunhat: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 6;
  }
}
