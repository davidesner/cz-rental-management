import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { organization, membership } from '../db/schema.js';

export interface CreateOrgInput {
  userId: string;
  name: string;
}

export interface OrgWithRole {
  id: string;
  name: string;
  role: 'owner' | 'member';
  membershipId: string;
}

export async function createOrganization(db: DB, input: CreateOrgInput): Promise<OrgWithRole> {
  const orgId = createId();
  const membershipId = createId();
  await db.transaction(async (tx) => {
    await tx.insert(organization).values({ id: orgId, name: input.name });
    await tx.insert(membership).values({
      id: membershipId,
      userId: input.userId,
      orgId,
      role: 'owner',
    });
  });
  return { id: orgId, name: input.name, role: 'owner', membershipId };
}

export async function listOrganizationsForUser(db: DB, userId: string): Promise<OrgWithRole[]> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      role: membership.role,
      membershipId: membership.id,
    })
    .from(organization)
    .innerJoin(membership, eq(membership.orgId, organization.id))
    .where(eq(membership.userId, userId));
  return rows;
}
