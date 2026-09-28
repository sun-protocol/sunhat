export type SunhatCleanErrorCode =
  | 'CLEAN_PATH_UNSAFE'
  | 'CLEAN_PATH_UNEXPECTED_TYPE';

export class SunhatCleanError extends Error {
  public readonly code: SunhatCleanErrorCode;

  public constructor(code: SunhatCleanErrorCode, message: string) {
    super(message);
    this.name = 'SunhatCleanError';
    this.code = code;
  }
}
