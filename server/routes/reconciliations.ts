import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { computeReconciliation, listReconciliations, getReconciliation, finalizeReconciliation, deleteReconciliation, recomputeReconciliation } from '../../core/services/reconciliation.js';
import type { AppEnv } from '../app.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ComputeBody = z.object({ periodFrom: DateStr, periodTo: DateStr, note: z.string().nullable().optional() });

export function reconciliationRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/contracts/:id/reconciliations/compute', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = ComputeBody.parse(await c.req.json());
    const db = c.get('db');
    const result = await computeReconciliation(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body);
    return c.json({ reconciliation: result }, 201);
  });

  r.get('/reconciliations', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    const contractId = c.req.query('contractId') ?? undefined;
    return c.json({ reconciliations: await listReconciliations(db, ctx.orgId, contractId, ctx.allowedPropertyIds) });
  });

  r.get('/reconciliations/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    return c.json({ reconciliation: await getReconciliation(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds) });
  });

  r.patch('/reconciliations/:id/finalize', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    return c.json({ reconciliation: await finalizeReconciliation(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds) });
  });

  r.delete('/reconciliations/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    await deleteReconciliation(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds);
    return c.body(null, 204);
  });

  r.post('/reconciliations/:id/recompute', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    return c.json({ reconciliation: await recomputeReconciliation(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds) });
  });

  return r;
}
