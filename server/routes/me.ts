import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getCtx } from '../middleware/auth.js';
import { user, membership, organization } from '../../core/db/schema.js';
import { AppError } from '../../core/errors.js';
import type { AppEnv } from '../app.js';

export function meRoutes() {
  const r = new Hono<AppEnv>();
  r.get('/me', async (c) => {
    const ctx = getCtx(c);
    const db = c.get('db');
    const u = await db.select().from(user).where(eq(user.id, ctx.userId)).get();
    if (!u) throw new AppError('not_found', 'user gone');
    const memberships = await db
      .select({
        membershipId: membership.id,
        orgId: membership.orgId,
        orgName: organization.name,
        role: membership.role,
      })
      .from(membership)
      .innerJoin(organization, eq(organization.id, membership.orgId))
      .where(eq(membership.userId, ctx.userId));
    return c.json({
      user: { id: u.id, email: u.email, name: u.name },
      memberships,
      activeOrgId: ctx.orgId,
    });
  });
  return r;
}
