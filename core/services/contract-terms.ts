import { createId } from '@paralleldrive/cuid2';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { contractTerms, contract } from '../db/schema.js';
import { AppError } from '../errors.js';

export interface CreateTermsInput {
  validFrom: string;
  baseRent: number;
  serviceAdvance: number;
  source: 'initial' | 'addendum' | 'change';
  note?: string | null;
}

export interface TermsRow {
  id: string;
  contractId: string;
  validFrom: string;
  validTo: string | null;
  baseRent: number;
  serviceAdvance: number;
  source: 'initial' | 'addendum' | 'change';
  note: string | null;
  createdAt: Date;
}

async function assertContractInOrg(db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null) {
  const [c] = await db.select().from(contract).where(and(eq(contract.id, contractId), eq(contract.orgId, orgId)));
  if (!c) throw new AppError('not_found', 'contract not in org');
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(c.propertyId)) {
    throw new AppError('forbidden', 'no access to contract\'s property');
  }
}

export async function addContractTerms(db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null, input: CreateTermsInput): Promise<TermsRow> {
  await assertContractInOrg(db, orgId, contractId, allowedPropertyIds);
  return db.transaction(async (tx) => {
    // Close any open row
    await tx.update(contractTerms)
      .set({ validTo: input.validFrom })
      .where(and(eq(contractTerms.contractId, contractId), isNull(contractTerms.validTo)));
    const id = createId();
    const [row] = await tx.insert(contractTerms).values({
      id, contractId,
      validFrom: input.validFrom,
      validTo: null,
      baseRent: input.baseRent,
      serviceAdvance: input.serviceAdvance,
      source: input.source,
      note: input.note ?? null,
    }).returning();
    return row!;
  });
}

export async function listContractTerms(db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null): Promise<TermsRow[]> {
  await assertContractInOrg(db, orgId, contractId, allowedPropertyIds);
  return db.select().from(contractTerms).where(eq(contractTerms.contractId, contractId)).orderBy(asc(contractTerms.validFrom));
}
