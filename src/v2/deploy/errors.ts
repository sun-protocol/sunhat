export type DeploymentErrorCode =
  | 'INVALID_DEPLOYMENT_PLAN'
  | 'NETWORK_IDENTITY_MISMATCH'
  | 'SNAPSHOT_MISMATCH'
  | 'ATTEMPT_CONFLICT'
  | 'ATTEMPT_NOT_FOUND'
  | 'BROADCAST_UNKNOWN'
  | 'RECEIPT_PENDING'
  | 'RECEIPT_FAILED'
  | 'RUNTIME_MISMATCH'
  | 'ARCHIVE_FAILED'
  | 'UNSAFE_ARCHIVE_PATH';

export class SunhatDeploymentError extends Error {
  public readonly code: DeploymentErrorCode;
  public readonly details?: Readonly<Record<string, string>>;

  public constructor(
    code: DeploymentErrorCode,
    message: string,
    details?: Readonly<Record<string, string>>
  ) {
    super(message);
    this.name = 'SunhatDeploymentError';
    this.code = code;
    this.details = details;
  }
}
