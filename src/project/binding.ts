import { readFileSync } from 'node:fs';
import { CliError, errorMessage } from '../errors.js';
import {
  bindingSchema,
  frameworkSchema,
  targetSchema,
} from './binding-schema.js';
import type { Binding } from './binding-schema.js';
import { parseToml } from './toml.js';

export type { Binding, Framework, Target } from './binding-schema.js';

export function readBinding(path: string): Binding {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new CliError(`cannot read ${path}: ${errorMessage(error)}`, 4, {
      cause: error,
    });
  }
  let document: unknown;
  try {
    document = parseToml(text);
  } catch (error) {
    throw new CliError(`invalid TOML in ${path}: ${errorMessage(error)}`, 4, {
      cause: error,
    });
  }
  return validateBinding(document, path);
}

export function validateBinding(document: unknown, path: string): Binding {
  const result = bindingSchema.safeParse(document);
  if (result.success) {
    return result.data;
  }
  switch (result.error.issues[0]?.path[1]) {
    case 'framework':
      throw new CliError(
        `invalid framework in ${path}; expected ${frameworkSchema.options.join(' or ')}`,
        4,
      );
    case 'target':
      throw new CliError(
        `invalid target in ${path}; expected ${targetSchema.options.join(' or ')}`,
        4,
      );
    default:
      throw new CliError(
        `invalid project binding in ${path}; expected a [project] table`,
        4,
      );
  }
}
