import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { createPropertyStub } from '../../core/services/property.js';
import type { AppEnv } from '../app.js';

const CreateProperty = z.object({ name: z.string().min(1).max(200) });

export function propertyRoutes() {
  const r = new Hono<AppEnv>();
  r.post('/properties', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const body = CreateProperty.parse(await c.req.json());
    const db = c.get('db');
    const p = await createPropertyStub(db, ctx.orgId, body.name);
    return c.json({ property: p }, 201);
  });
  return r;
}
