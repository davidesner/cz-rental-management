import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { createOrganization, listOrganizationsForUser } from '../../core/services/organization.js';
import type { AppEnv } from '../app.js';

const CreateOrg = z.object({ name: z.string().min(1).max(200) });

export function organizationRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/organizations', async (c) => {
    const ctx = getCtx(c);
    const body = CreateOrg.parse(await c.req.json());
    const db = c.get('db');
    const org = await createOrganization(db, { userId: ctx.userId, name: body.name });
    return c.json({ organization: org }, 201);
  });

  r.get('/organizations', async (c) => {
    const ctx = getCtx(c);
    const db = c.get('db');
    const orgs = await listOrganizationsForUser(db, ctx.userId);
    return c.json({ organizations: orgs });
  });

  return r;
}
