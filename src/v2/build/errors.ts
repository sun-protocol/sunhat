export type SunhatBuildErrorCode =
  | 'BUILD_FAILED'
  | 'COMPILER_INTEGRITY_MISMATCH'
  | 'COMPILER_PROCESS_FAILED'
  | 'EMPTY_BUILD_TARGET'
  | 'INVALID_BUILD_OUTPUT'
  | 'MISSING_COMPILER_EXECUTABLE'
  | 'SNAPSHOT_INTEGRITY_MISMATCH'
  | 'SOURCE_OUTSIDE_PROJECT'
  | 'UNSUPPORTED_SOURCE_LAYOUT';

export class SunhatBuildError extends Error {
  public constructor(
    public readonly code: SunhatBuildErrorCode,
    message: string,
    public readonly diagnostics: readonly BuildDiagnostic[] = []
  ) {
    super(message);
    this.name = 'SunhatBuildError';
  }
}

export interface BuildDiagnostic {
  readonly code?: string;
  readonly column?: number;
  readonly file?: string;
  readonly line?: number;
  readonly message: string;
  readonly severity: 'error' | 'warning';
  readonly type?: string;
}
