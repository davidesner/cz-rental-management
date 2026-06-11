import type { Context } from 'hono';
import { AppError } from '../../core/errors.js';

const statusByKind: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  validation: 422,
  unauthenticated: 401,
  bad_request: 400,
  must_change_password: 403,
};

export function errorMiddleware(err: Error, c: Context) {
  if (err instanceof AppError) {
    const status = statusByKind[err.kind] ?? 500;
    return c.json({ error: { kind: err.kind, message: err.message, details: err.details } }, status as never);
  }
  console.error(err);
  return c.json({ error: { kind: 'internal', message: 'internal error' } }, 500);
}
