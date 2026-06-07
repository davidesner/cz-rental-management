import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { rentReduction, contract } from '../db/schema.js';
import { AppError } from '../errors.js';

export interface RentReductionRow {
  id: string;
  orgId: string;
  contractId: string;
  forMonth: string;        // YYYY-MM-01
  amount: number;          // haléře
  reason: string | null;
  createdAt: Date;
}

async function assertContract(db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null) {
  const [c] = await db.select().from(contract).where(and(eq(contract.id, contractId), eq(contract.orgId, orgId)));
  if (!c) throw new AppError('not_found', 'contract not in org');
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(c.propertyId)) {
    throw new AppError('forbidden', 'no access');
  }
  return c;
}

export async function addRentReduction(
  db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null,
  input: { forMonth: string; amount: number; reason?: string | null },
): Promise<RentReductionRow> {
  await assertContract(db, orgId, contractId, allowedPropertyIds);
  // Normalize forMonth to first of month
  const month = `${input.forMonth.slice(0, 7)}-01`;
  const id = createId();
  const [row] = await db.insert(rentReduction).values({
    id, orgId, contractId, forMonth: month,
    amount: input.amount, reason: input.reason ?? null,
  }).returning();
  return row! as RentReductionRow;
}

export async function listRentReductions(
  db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null,
): Promise<RentReductionRow[]> {
  await assertContract(db, orgId, contractId, allowedPropertyIds);
  return db.select().from(rentReduction).where(eq(rentReduction.contractId, contractId)) as Promise<RentReductionRow[]>;
}

export async function deleteRentReduction(
  db: DB, orgId: string, contractId: string, id: string, allowedPropertyIds: string[] | null,
): Promise<void> {
  await assertContract(db, orgId, contractId, allowedPropertyIds);
  const result = await db.delete(rentReduction)
    .where(and(eq(rentReduction.id, id), eq(rentReduction.orgId, orgId), eq(rentReduction.contractId, contractId)))
    .returning({ id: rentReduction.id });
  if (result.length === 0) throw new AppError('not_found', 'rent reduction not found');
}
