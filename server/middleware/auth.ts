import type { Context, Next } from 'hono';
import { asc, eq } from 'drizzle-orm';
import type { DB } from '../../core/db/client.js';
import type { Auth } from '../../core/auth/better-auth.js';
import { AppError } from '../../core/errors.js';
import type { AuthContext, Role } from '../../core/auth/context.js';
import { apiToken, membership, propertyAccess, user } from '../../core/db/schema.js';
import { hashToken } from '../../core/auth/token.js';

async function pickMembership(db: DB, userId: string, orgIdHint?: string) {
  const rows = await db
    .select()
    .from(membership)
    .where(eq(membership.userId, userId))
    .orderBy(asc(membership.createdAt));
  if (rows.length === 0) return null;
  if (orgIdHint) return rows.find((r) => r.orgId === orgIdHint) ?? null;
  return rows[0] ?? null;
}

async function loadAllowedProperties(db: DB, membershipId: string, role: Role): Promise<string[] | null> {
  if (role === 'owner') return null;
  const rows = await db.select().from(propertyAccess).where(eq(propertyAccess.membershipId, membershipId));
  return rows.map((r) => r.propertyId);
}

// Routes that remain reachable when mustChangePassword is true. Everything else
// (properties, payments, reconciliations, …) is blocked until the user picks a
// new password. /api/auth/* is already excluded one layer up in server/app.ts,
// so the change-password endpoint itself isn't listed here.
const PATHS_ALLOWED_WHILE_MUST_CHANGE_PASSWORD = new Set([
  '/api/me',
]);

async function assertPasswordOk(db: DB, userId: string, path: string) {
  if (PATHS_ALLOWED_WHILE_MUST_CHANGE_PASSWORD.has(path)) return;
  const [u] = await db.select({ mustChange: user.mustChangePassword }).from(user).where(eq(user.id, userId));
  if (u?.mustChange) {
    throw new AppError('must_change_password', 'password change required before using the API');
  }
}

export function authMiddleware() {
  return async (c: Context, next: Next) => {
    const db = c.get('db') as DB;
    const auth = c.get('auth') as Auth;

    // 1) Try Bearer token
    const authz = c.req.header('authorization');
    if (authz?.startsWith('Bearer ')) {
      const token = authz.slice('Bearer '.length).trim();
      const [row] = await db.select().from(apiToken).where(eq(apiToken.tokenHash, hashToken(token)));
      if (!row) throw new AppError('unauthenticated', 'invalid token');
      const [m] = await db.select().from(membership).where(eq(membership.id, row.membershipId));
      if (!m) throw new AppError('unauthenticated', 'membership missing for token');
      await assertPasswordOk(db, m.userId, c.req.path);
      await db.update(apiToken)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiToken.id, row.id));
      const allowed = await loadAllowedProperties(db, m.id, m.role as Role);
      const ctx: AuthContext = {
        userId: m.userId, orgId: m.orgId, membershipId: m.id, role: m.role as Role, allowedPropertyIds: allowed,
      };
      c.set('auth_ctx', ctx);
      return next();
    }

    // 2) Try better-auth session
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new AppError('unauthenticated', 'no session');
    await assertPasswordOk(db, session.user.id, c.req.path);
    const orgHint = c.req.header('x-org-id') ?? undefined;
    const m = await pickMembership(db, session.user.id, orgHint);
    if (!m) {
      const ctx: AuthContext = {
        userId: session.user.id, orgId: null, membershipId: null, role: null, allowedPropertyIds: null,
      };
      c.set('auth_ctx', ctx);
      return next();
    }
    const allowed = await loadAllowedProperties(db, m.id, m.role as Role);
    const ctx: AuthContext = {
      userId: m.userId, orgId: m.orgId, membershipId: m.id, role: m.role as Role, allowedPropertyIds: allowed,
    };
    c.set('auth_ctx', ctx);
    return next();
  };
}

export function getCtx(c: Context): AuthContext {
  const ctx = c.get('auth_ctx') as AuthContext | undefined;
  if (!ctx) throw new AppError('unauthenticated', 'no auth context');
  return ctx;
}
