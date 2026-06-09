import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { addContractTerms, listContractTerms } from '../../core/services/contract-terms.js';
import type { AppEnv } from '../app.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateTerms = z.object({
  validFrom: DateStr,
  baseRent: z.number().int().nonnegative(),
  serviceAdvance: z.number().int().nonnegative(),
  paymentDueDay: z.number().int().min(1).max(31).optional(),
  paymentAppliesTo: z.enum(['current', 'next']).optional(),
  source: z.enum(['initial', 'addendum', 'change']),
  note: z.string().nullable().optional(),
});

export function contractTermsRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/contracts/:id/terms', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = CreateTerms.parse(await c.req.json());
    const db = c.get('db');
    const created = await addContractTerms(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body);
    return c.json({ terms: created }, 201);
  });

  r.get('/contracts/:id/terms', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    const rows = await listContractTerms(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds);
    return c.json({ terms: rows });
  });

  return r;
}
