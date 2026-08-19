import type { Context, Next } from 'hono';
import { asc, eq } from 'drizzle-orm';
import type { DB } from '../../core/db/client.js';
import type { Auth } from '../../core/auth/better-auth.js';
import { AppError } from '../../core/errors.js';
import type { AuthContext, Role } from '../../core/auth/context.js';
import { apiToken, membership, propertyAccess, user } from '../../core/db/schema.js';
import { hashToken } from '../../core/auth/token.js';

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

function assertPasswordOk(mustChange: boolean | undefined, path: string) {
  if (PATHS_ALLOWED_WHILE_MUST_CHANGE_PASSWORD.has(path)) return;
  if (mustChange) {
    throw new AppError('must_change_password', 'password change required before using the API');
  }
}

/**
 * One round-trip for both things the middleware needs about a user: the
 * memberships to pick an org from, and a *fresh* `mustChangePassword`.
 *
 * These used to be two sequential queries, and the password read duplicated the
 * user row Better Auth had already fetched while resolving the session. Reading
 * the flag off `session.user` instead would drop a query, but it would tie a
 * security gate to Better Auth's session caching — enabling `session.cookieCache`
 * later would silently serve a stale flag and stop enforcing forced resets. The
 * join keeps the flag authoritative while still costing a single round-trip.
 *
 * LEFT JOIN, not INNER: a user with no membership must still yield their
 * password flag (and a null-org auth context), which an inner join would drop.
 */
async function loadUserAuthRows(db: DB, userId: string) {
  return db
    .select({
      mustChangePassword: user.mustChangePassword,
      membershipId: membership.id,
      membershipUserId: membership.userId,
      orgId: membership.orgId,
      role: membership.role,
    })
    .from(user)
    .leftJoin(membership, eq(membership.userId, user.id))
    .where(eq(user.id, userId))
    .orderBy(asc(membership.createdAt));
}

type UserAuthRow = Awaited<ReturnType<typeof loadUserAuthRows>>[number];

function pickMembership(rows: UserAuthRow[], orgIdHint?: string) {
  const withMembership = rows.filter((r) => r.membershipId !== null);
  if (withMembership.length === 0) return null;
  if (orgIdHint) return withMembership.find((r) => r.orgId === orgIdHint) ?? null;
  return withMembership[0] ?? null;
}

export function authMiddleware() {
  return async (c: Context, next: Next) => {
    const db = c.get('db') as DB;
    const auth = c.get('auth') as Auth;

    // 1) Try Bearer token
    const authz = c.req.header('authorization');
    if (authz?.startsWith('Bearer ')) {
      const token = authz.slice('Bearer '.length).trim();
      // Token → membership → owning user's password flag in one round-trip.
      // LEFT JOINs so a token whose membership was deleted still reports
      // "membership missing" rather than looking like an invalid token.
      const [row] = await db
        .select({
          tokenId: apiToken.id,
          membershipId: membership.id,
          membershipUserId: membership.userId,
          orgId: membership.orgId,
          role: membership.role,
          mustChangePassword: user.mustChangePassword,
        })
        .from(apiToken)
        .leftJoin(membership, eq(membership.id, apiToken.membershipId))
        .leftJoin(user, eq(user.id, membership.userId))
        .where(eq(apiToken.tokenHash, hashToken(token)));
      if (!row) throw new AppError('unauthenticated', 'invalid token');
      if (!row.membershipId || !row.membershipUserId) {
        throw new AppError('unauthenticated', 'membership missing for token');
      }
      assertPasswordOk(row.mustChangePassword ?? false, c.req.path);
      await db.update(apiToken)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiToken.id, row.tokenId));
      const allowed = await loadAllowedProperties(db, row.membershipId, row.role as Role);
      const ctx: AuthContext = {
        userId: row.membershipUserId,
        orgId: row.orgId,
        membershipId: row.membershipId,
        role: row.role as Role,
        allowedPropertyIds: allowed,
      };
      c.set('auth_ctx', ctx);
      return next();
    }

    // 2) Try better-auth session
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new AppError('unauthenticated', 'no session');
    const rows = await loadUserAuthRows(db, session.user.id);
    assertPasswordOk(rows[0]?.mustChangePassword, c.req.path);
    const orgHint = c.req.header('x-org-id') ?? undefined;
    const m = pickMembership(rows, orgHint);
    if (!m || !m.membershipId || !m.membershipUserId) {
      const ctx: AuthContext = {
        userId: session.user.id, orgId: null, membershipId: null, role: null, allowedPropertyIds: null,
      };
      c.set('auth_ctx', ctx);
      return next();
    }
    const allowed = await loadAllowedProperties(db, m.membershipId, m.role as Role);
    const ctx: AuthContext = {
      userId: m.membershipUserId,
      orgId: m.orgId,
      membershipId: m.membershipId,
      role: m.role as Role,
      allowedPropertyIds: allowed,
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
