export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 2,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CliError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

export function usage(message: string, options?: ErrorOptions): never {
  throw new CliError(message, 2, options);
}

export function toolchainError(message: string, options?: ErrorOptions): never {
  throw new CliError(message, 3, options);
}
