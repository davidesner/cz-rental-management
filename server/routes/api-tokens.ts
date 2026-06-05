import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { issueApiToken, listApiTokens, revokeApiToken } from '../../core/services/api-token.js';
import type { AppEnv } from '../app.js';

const CreateToken = z.object({ name: z.string().min(1).max(120) });

export function apiTokenRoutes() {
  const r = new Hono<AppEnv>();

  r.post('/api-tokens', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const body = CreateToken.parse(await c.req.json());
    const db = c.get('db');
    const created = await issueApiToken(db, ctx.membershipId, body.name);
    return c.json(created, 201);
  });

  r.get('/api-tokens', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const db = c.get('db');
    const tokens = await listApiTokens(db, ctx.membershipId);
    return c.json({ tokens });
  });

  r.delete('/api-tokens/:id', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const db = c.get('db');
    await revokeApiToken(db, ctx.membershipId, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
