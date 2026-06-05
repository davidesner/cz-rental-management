import { describe, it, expect } from 'vitest';
import { AppError } from '../core/errors.js';
import { Hono } from 'hono';
import { errorMiddleware } from '../server/middleware/errors.js';

describe('error middleware', () => {
  const app = new Hono();
  app.onError(errorMiddleware);
  app.get('/not-found', () => { throw new AppError('not_found', 'no'); });
  app.get('/forbidden', () => { throw new AppError('forbidden', 'no'); });
  app.get('/conflict', () => { throw new AppError('conflict', 'no'); });
  app.get('/validation', () => { throw new AppError('validation', 'no', { field: 'x' }); });
  app.get('/unauth', () => { throw new AppError('unauthenticated', 'no'); });
  app.get('/boom', () => { throw new Error('boom'); });

  it.each([
    ['/not-found', 404],
    ['/forbidden', 403],
    ['/conflict', 409],
    ['/validation', 422],
    ['/unauth', 401],
    ['/boom', 500],
  ])('maps %s to %i', async (path, status) => {
    const res = await app.request(path);
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
