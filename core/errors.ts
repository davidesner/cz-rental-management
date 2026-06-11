export type AppErrorKind =
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'validation'
  | 'unauthenticated'
  | 'bad_request'
  | 'must_change_password';

export class AppError extends Error {
  constructor(
    public readonly kind: AppErrorKind,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
