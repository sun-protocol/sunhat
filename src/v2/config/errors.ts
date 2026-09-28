export type SunhatConfigErrorCode =
  | 'AMBIGUOUS_TARGET'
  | 'COMPILER_CHAIN_MISMATCH'
  | 'DUPLICATE_COMPILER'
  | 'EMPTY_TARGETS'
  | 'INVALID_CONFIG'
  | 'INVALID_NETWORK_BINDING'
  | 'INVALID_PATH'
  | 'INVALID_VERSION'
  | 'MISSING_COMPILER_INTEGRITY'
  | 'NETWORK_TARGET_MISMATCH'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_SELECTION_CONFLICT'
  | 'TRON_TEST_NETWORK_REQUIRED';

export class SunhatConfigError extends Error {
  public readonly code: SunhatConfigErrorCode;
  public readonly configPath: string;

  public constructor(
    code: SunhatConfigErrorCode,
    configPath: string,
    message: string
  ) {
    super(`${configPath}: ${message}`);
    this.name = 'SunhatConfigError';
    this.code = code;
    this.configPath = configPath;
  }
}
