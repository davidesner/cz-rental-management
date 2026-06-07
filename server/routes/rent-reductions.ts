import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { addRentReduction, listRentReductions, deleteRentReduction } from '../../core/services/rent-reduction.js';
import type { AppEnv } from '../app.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const AddBody = z.object({
  forMonth: DateStr,
  amount: z.number().int().nonnegative(),
  reason: z.string().nullable().optional(),
});

export function rentReductionRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/contracts/:id/rent-reductions', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = AddBody.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ rentReduction: await addRentReduction(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body) }, 201);
  });

  r.get('/contracts/:id/rent-reductions', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    return c.json({ rentReductions: await listRentReductions(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds) });
  });

  r.delete('/contracts/:id/rent-reductions/:rid', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    await deleteRentReduction(db, ctx.orgId, c.req.param('id'), c.req.param('rid'), ctx.allowedPropertyIds);
    return c.body(null, 204);
  });

  return r;
}
