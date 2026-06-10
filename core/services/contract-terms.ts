import { createId } from '@paralleldrive/cuid2';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { contractTerms, contract } from '../db/schema.js';
import { AppError } from '../errors.js';

export interface CreateTermsInput {
  validFrom: string;
  baseRent: number;
  serviceAdvance: number;
  paymentDueDay?: number;
  paymentAppliesTo?: 'current' | 'next';
  source: 'initial' | 'addendum' | 'change';
  documentRef?: string | null;
  note?: string | null;
}

export interface TermsRow {
  id: string;
  contractId: string;
  validFrom: string;
  validTo: string | null;
  baseRent: number;
  serviceAdvance: number;
  paymentDueDay: number;
  paymentAppliesTo: 'current' | 'next';
  source: 'initial' | 'addendum' | 'change';
  documentRef: string | null;
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
    // Find current open row to inherit payment* from if not explicitly set
    const [openTerms] = await tx.select().from(contractTerms)
      .where(and(eq(contractTerms.contractId, contractId), isNull(contractTerms.validTo)));

    const paymentDueDay = input.paymentDueDay ?? openTerms?.paymentDueDay ?? 10;
    const paymentAppliesTo = input.paymentAppliesTo
      ?? (openTerms?.paymentAppliesTo as 'current' | 'next' | undefined)
      ?? 'current';

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
      paymentDueDay,
      paymentAppliesTo,
      source: input.source,
      documentRef: input.documentRef ?? null,
      note: input.note ?? null,
    }).returning();
    return row!;
  });
}

export async function listContractTerms(db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null): Promise<TermsRow[]> {
  await assertContractInOrg(db, orgId, contractId, allowedPropertyIds);
  return db.select().from(contractTerms).where(eq(contractTerms.contractId, contractId)).orderBy(asc(contractTerms.validFrom));
}

export interface UpdateTermsInput {
  baseRent?: number;
  serviceAdvance?: number;
  paymentDueDay?: number;
  paymentAppliesTo?: 'current' | 'next';
  source?: 'initial' | 'addendum' | 'change';
  documentRef?: string | null;
  note?: string | null;
}

/**
 * Patch an existing contract terms row. validFrom + contractId are immutable — changing
 * either would corrupt the SCD2 timeline used by allocation logic.
 * To "move" a terms row in time, delete and re-add via `addContractTerms`.
 */
export async function updateContractTerms(
  db: DB, orgId: string, contractId: string, termsId: string,
  allowedPropertyIds: string[] | null, input: UpdateTermsInput,
): Promise<TermsRow> {
  await assertContractInOrg(db, orgId, contractId, allowedPropertyIds);
  const [existing] = await db.select().from(contractTerms)
    .where(and(eq(contractTerms.id, termsId), eq(contractTerms.contractId, contractId)));
  if (!existing) throw new AppError('not_found', 'terms not in contract');

  const patch: Record<string, unknown> = {};
  for (const key of ['baseRent', 'serviceAdvance', 'paymentDueDay', 'paymentAppliesTo', 'source', 'documentRef', 'note'] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  if (Object.keys(patch).length === 0) return existing as TermsRow;

  const [row] = await db.update(contractTerms).set(patch)
    .where(and(eq(contractTerms.id, termsId), eq(contractTerms.contractId, contractId)))
    .returning();
  return row! as TermsRow;
}
