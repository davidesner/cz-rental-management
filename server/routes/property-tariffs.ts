import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { addPropertyTariff, listPropertyTariffs } from '../../core/services/property-tariff.js';
import type { AppEnv } from '../app.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateTariff = z.object({
  validFrom: DateStr,
  totalSvjAdvance: z.number().int().nonnegative(),
  deductibleAmount: z.number().int().nonnegative(),
  deductibleNote: z.string().nullable().optional(),
  documentRef: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export function propertyTariffRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/properties/:id/tariffs', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = CreateTariff.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ tariff: await addPropertyTariff(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body) }, 201);
  });

  r.get('/properties/:id/tariffs', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    return c.json({ tariffs: await listPropertyTariffs(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds) });
  });

  return r;
}
