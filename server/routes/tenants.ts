import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { createTenant, listTenants, getTenant, updateTenant } from '../../core/services/tenant.js';
import type { AppEnv } from '../app.js';

const CreateTenant = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  accountNumber: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

const UpdateTenant = CreateTenant.partial();

export function tenantRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/tenants', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = CreateTenant.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ tenant: await createTenant(db, ctx.orgId, body) }, 201);
  });

  r.get('/tenants', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    return c.json({ tenants: await listTenants(db, ctx.orgId) });
  });

  r.get('/tenants/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const db = c.get('db');
    return c.json({ tenant: await getTenant(db, ctx.orgId, c.req.param('id')) });
  });

  r.patch('/tenants/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = UpdateTenant.parse(await c.req.json());
    const db = c.get('db');
    return c.json({ tenant: await updateTenant(db, ctx.orgId, c.req.param('id'), body) });
  });

  return r;
}
