import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { propertyAccess, membership, property } from '../db/schema.js';
import { AppError } from '../errors.js';

export async function grantPropertyAccess(db: DB, orgId: string, membershipId: string, propertyId: string) {
  const m = await db.select().from(membership).where(eq(membership.id, membershipId)).get();
  if (!m || m.orgId !== orgId) throw new AppError('not_found', 'membership not in org');
  const p = await db.select().from(property).where(eq(property.id, propertyId)).get();
  if (!p || p.orgId !== orgId) throw new AppError('not_found', 'property not in org');
  await db.insert(propertyAccess).values({ membershipId, propertyId }).onConflictDoNothing();
}

export async function listPropertyAccess(db: DB, orgId: string, membershipId: string): Promise<string[]> {
  const m = await db.select().from(membership).where(eq(membership.id, membershipId)).get();
  if (!m || m.orgId !== orgId) throw new AppError('not_found', 'membership not in org');
  const rows = await db.select().from(propertyAccess).where(eq(propertyAccess.membershipId, membershipId));
  return rows.map((r) => r.propertyId);
}

export async function revokePropertyAccess(db: DB, orgId: string, membershipId: string, propertyId: string) {
  const m = await db.select().from(membership).where(eq(membership.id, membershipId)).get();
  if (!m || m.orgId !== orgId) throw new AppError('not_found', 'membership not in org');
  await db.delete(propertyAccess).where(
    and(eq(propertyAccess.membershipId, membershipId), eq(propertyAccess.propertyId, propertyId)),
  );
}
