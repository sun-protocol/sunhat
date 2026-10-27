export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 2,
  ) {
    super(message);
    this.name = 'CliError';
  }
}
export function usage(message: string): never {
  throw new CliError(message, 2);
}
export function toolchainError(message: string): never {
  throw new CliError(message, 3);
}
