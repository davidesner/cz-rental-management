import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { createCostStatement, listCostStatements, getCostStatement, updateCostStatement, deleteCostStatement } from '../../core/services/cost-statement.js';
import type { AppEnv } from '../app.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Kind = z.enum(['services', 'electricity', 'gas', 'internet', 'water', 'other']);

const CreateBody = z.object({
  propertyId: z.string(),
  kind: Kind,
  periodFrom: DateStr,
  periodTo: DateStr,
  totalAmount: z.number().int(),
  adjustmentAmount: z.number().int().optional(),
  adjustmentNote: z.string().nullable().optional(),
  documentRef: z.string().nullable().optional(),
  issuedAt: DateStr.nullable().optional(),
  note: z.string().nullable().optional(),
});

const UpdateBody = CreateBody.partial();

export function costStatementRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/cost-statements', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = CreateBody.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ statement: await createCostStatement(db, ctx.orgId, ctx.allowedPropertyIds, body) }, 201);
  });

  r.get('/cost-statements', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    const filters = {
      propertyId: c.req.query('propertyId') ?? undefined,
      kind: c.req.query('kind') as any,
      from: c.req.query('from') ?? undefined,
      to: c.req.query('to') ?? undefined,
    };
    return c.json({ statements: await listCostStatements(db, ctx.orgId, ctx.allowedPropertyIds, filters) });
  });

  r.get('/cost-statements/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    return c.json({ statement: await getCostStatement(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds) });
  });

  r.patch('/cost-statements/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = UpdateBody.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ statement: await updateCostStatement(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body) });
  });

  r.delete('/cost-statements/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    await deleteCostStatement(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds);
    return c.body(null, 204);
  });

  return r;
}
