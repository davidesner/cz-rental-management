import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { paymentBreakdown } from '../../core/services/payment-breakdown.js';
import type { AppEnv } from '../app.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function paymentBreakdownRoutes() {
  const r = new Hono<AppEnv>();
  r.get('/contracts/:id/payment-breakdown', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const from = c.req.query('from');
    const to = c.req.query('to');
    if (!from || !to) {
      return c.json({ error: { kind: 'bad_request', message: 'from + to required' } }, 400);
    }
    DateStr.parse(from); DateStr.parse(to);
    const db = c.get('db');
    return c.json(await paymentBreakdown(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, from, to));
  });
  return r;
}
