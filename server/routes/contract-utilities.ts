import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { addContractUtility, listContractUtilities } from '../../core/services/contract-utility.js';
import type { AppEnv } from '../app.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateUtility = z.object({
  kind: z.enum(['electricity', 'gas', 'internet', 'water', 'other']),
  validFrom: DateStr,
  monthlyAdvance: z.number().int().nonnegative(),
  note: z.string().nullable().optional(),
});

export function contractUtilityRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/contracts/:id/utilities', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = CreateUtility.parse(await c.req.json());
    const db = c.get('db');
    const row = await addContractUtility(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body);
    return c.json({ utility: row }, 201);
  });

  r.get('/contracts/:id/utilities', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    const rows = await listContractUtilities(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds);
    return c.json({ utilities: rows });
  });

  return r;
}
