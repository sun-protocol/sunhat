export type SunhatCliErrorCode =
  | 'AMBIGUOUS_CONFIG'
  | 'CLI_RECURSION'
  | 'COMMAND_ARGUMENT_INVALID'
  | 'CONFIG_ARGUMENT_INVALID'
  | 'DEPENDENCY_INSTALL_FAILED'
  | 'INCOMPATIBLE_HARDHAT'
  | 'INCOMPATIBLE_NODE'
  | 'INCOMPATIBLE_SUNHAT'
  | 'INVALID_LOCAL_PACKAGE'
  | 'INVALID_PROJECT_NAME'
  | 'LOCAL_DEPENDENCY_MISSING'
  | 'PROJECT_EXISTS'
  | 'PROJECT_NOT_FOUND'
  | 'TEMPLATE_WRITE_FAILED';

export class SunhatCliError extends Error {
  public constructor(
    public readonly code: SunhatCliErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SunhatCliError';
  }
}
