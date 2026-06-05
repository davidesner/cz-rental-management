import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { recordPayment, recordPaymentsBatch, listPayments, getPayment, assignPaymentToContract, updatePayment, deletePayment } from '../../core/services/payment.js';
import type { AppEnv } from '../app.js';

const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const PaymentBody = z.object({
  contractId: z.string().nullable().optional(),
  amount: z.number().int(),
  paidAt: DateStr,
  counterparty: z.string().nullable().optional(),
  counterpartyAccount: z.string().nullable().optional(),
  externalId: z.string().nullable().optional(),
  statementRef: z.string().nullable().optional(),
  source: z.enum(['bank', 'manual']),
  description: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

const UpdatePaymentBody = z.object({
  contractId: z.string().nullable().optional(),
  amount: z.number().int().optional(),
  paidAt: DateStr.optional(),
  counterparty: z.string().nullable().optional(),
  counterpartyAccount: z.string().nullable().optional(),
  statementRef: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

const AssignBody = z.object({ contractId: z.string().nullable() });

export function paymentRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/payments', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = PaymentBody.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ payment: await recordPayment(db, ctx.orgId, ctx.allowedPropertyIds, body) }, 201);
  });

  r.post('/payments/batch', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = z.array(PaymentBody).parse(await c.req.json());
    const db = c.get('db');
    const result = await recordPaymentsBatch(db, ctx.orgId, ctx.allowedPropertyIds, body);
    return c.json(result, 201);
  });

  r.get('/payments', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    const filters = {
      contractId: c.req.query('contractId') ?? undefined,
      unassigned: c.req.query('unassigned') === 'true',
      from: c.req.query('from') ?? undefined,
      to: c.req.query('to') ?? undefined,
    };
    return c.json({ payments: await listPayments(db, ctx.orgId, ctx.allowedPropertyIds, filters) });
  });

  r.get('/payments/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    return c.json({ payment: await getPayment(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds) });
  });

  r.patch('/payments/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = UpdatePaymentBody.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ payment: await updatePayment(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body) });
  });

  r.patch('/payments/:id/assign', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = AssignBody.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ payment: await assignPaymentToContract(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body.contractId) });
  });

  r.delete('/payments/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    await deletePayment(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds);
    return c.body(null, 204);
  });

  return r;
}
