import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { AppError } from '../../core/errors.js';
import { grantPropertyAccess, listPropertyAccess, revokePropertyAccess }
  from '../../core/services/property-access.js';
import type { AppEnv } from '../app.js';

const Grant = z.object({ membershipId: z.string(), propertyId: z.string() });

export function propertyAccessRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/property-access', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    if (ctx.role !== 'owner') throw new AppError('forbidden', 'owner only');
    const body = Grant.parse(await c.req.json());
    const db = c.get('db');
    await grantPropertyAccess(db, ctx.orgId, body.membershipId, body.propertyId);
    return c.json({ ok: true }, 201);
  });

  r.get('/property-access', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const membershipId = c.req.query('membershipId');
    if (!membershipId) throw new AppError('bad_request', 'membershipId required');
    const db = c.get('db');
    const propertyIds = await listPropertyAccess(db, ctx.orgId, membershipId);
    return c.json({ propertyIds });
  });

  r.delete('/property-access', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    if (ctx.role !== 'owner') throw new AppError('forbidden', 'owner only');
    const membershipId = c.req.query('membershipId');
    const propertyId = c.req.query('propertyId');
    if (!membershipId || !propertyId) throw new AppError('bad_request', 'membershipId + propertyId required');
    const db = c.get('db');
    await revokePropertyAccess(db, ctx.orgId, membershipId, propertyId);
    return c.body(null, 204);
  });

  return r;
}
