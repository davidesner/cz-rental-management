import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { createContract, listContracts, getContract, updateContract } from '../../core/services/contract.js';
import type { AppEnv } from '../app.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateContract = z.object({
  propertyId: z.string(),
  tenantId: z.string(),
  startDate: DateStr,
  endDate: DateStr.nullable().optional(),
  securityDeposit: z.number().int().nonnegative().nullable().optional(),
  note: z.string().nullable().optional(),
  paymentDueDay: z.number().int().min(1).max(31).optional(),
  paymentAppliesTo: z.enum(['current', 'next']).optional(),
});

const UpdateContract = z.object({
  startDate: DateStr.optional(),
  endDate: DateStr.nullable().optional(),
  securityDeposit: z.number().int().nonnegative().nullable().optional(),
  note: z.string().nullable().optional(),
  paymentDueDay: z.number().int().min(1).max(31).optional(),
  paymentAppliesTo: z.enum(['current', 'next']).optional(),
});

export function contractRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/contracts', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = CreateContract.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ contract: await createContract(db, ctx.orgId, body) }, 201);
  });

  r.get('/contracts', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    return c.json({ contracts: await listContracts(db, ctx.orgId, ctx.allowedPropertyIds) });
  });

  r.get('/contracts/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    return c.json({ contract: await getContract(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds) });
  });

  r.patch('/contracts/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = UpdateContract.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ contract: await updateContract(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body) });
  });

  return r;
}
