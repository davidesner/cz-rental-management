import { createId } from '@paralleldrive/cuid2';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { contractUtility, contract } from '../db/schema.js';
import { AppError } from '../errors.js';

export type UtilityKind = 'electricity' | 'gas' | 'internet' | 'water' | 'other';

export interface CreateUtilityInput {
  kind: UtilityKind;
  validFrom: string;
  monthlyAdvance: number;
  note?: string | null;
}

export interface UtilityRow {
  id: string;
  contractId: string;
  kind: UtilityKind;
  validFrom: string;
  validTo: string | null;
  monthlyAdvance: number;
  note: string | null;
  createdAt: Date;
}

async function assertContractInOrg(db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null) {
  const [c] = await db.select().from(contract).where(and(eq(contract.id, contractId), eq(contract.orgId, orgId)));
  if (!c) throw new AppError('not_found', 'contract not in org');
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(c.propertyId)) {
    throw new AppError('forbidden', 'no access');
  }
}

export async function addContractUtility(db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null, input: CreateUtilityInput): Promise<UtilityRow> {
  await assertContractInOrg(db, orgId, contractId, allowedPropertyIds);
  return db.transaction(async (tx) => {
    await tx.update(contractUtility)
      .set({ validTo: input.validFrom })
      .where(and(eq(contractUtility.contractId, contractId), eq(contractUtility.kind, input.kind), isNull(contractUtility.validTo)));
    const id = createId();
    const [row] = await tx.insert(contractUtility).values({
      id, contractId, kind: input.kind,
      validFrom: input.validFrom, validTo: null,
      monthlyAdvance: input.monthlyAdvance,
      note: input.note ?? null,
    }).returning();
    return row! as UtilityRow;
  });
}

export async function listContractUtilities(db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null): Promise<UtilityRow[]> {
  await assertContractInOrg(db, orgId, contractId, allowedPropertyIds);
  const rows = await db.select().from(contractUtility).where(eq(contractUtility.contractId, contractId)).orderBy(asc(contractUtility.kind), asc(contractUtility.validFrom));
  return rows as UtilityRow[];
}
