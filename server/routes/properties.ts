import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { createProperty, listProperties, getProperty, updateProperty } from '../../core/services/property.js';
import type { AppEnv } from '../app.js';

const CreateProperty = z.object({
  name: z.string().min(1).max(200),
  address: z.string().nullable().optional(),
  reconciliationSkill: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

const UpdateProperty = CreateProperty.partial();

export function propertyRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/properties', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const body = CreateProperty.parse(await c.req.json());
    const db = c.get('db');
    const created = await createProperty(db, ctx.orgId, body);
    return c.json({ property: created }, 201);
  });

  r.get('/properties', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const db = c.get('db');
    const list = await listProperties(db, ctx.orgId, ctx.allowedPropertyIds);
    return c.json({ properties: list });
  });

  r.get('/properties/:id', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const db = c.get('db');
    const found = await getProperty(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds);
    return c.json({ property: found });
  });

  r.patch('/properties/:id', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const body = UpdateProperty.parse(await c.req.json());
    const db = c.get('db');
    const updated = await updateProperty(db, ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body);
    return c.json({ property: updated });
  });

  return r;
}
