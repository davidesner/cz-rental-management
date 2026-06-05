import { Hono } from 'hono';
import { getCtx } from '../middleware/auth.js';

export function meRoutes() {
  const r = new Hono();
  r.get('/me', (c) => {
    const ctx = getCtx(c);
    return c.json({ ctx });
  });
  return r;
}
