import { createId } from '@paralleldrive/cuid2';
import { and, eq, isNull, gte, lte, desc } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { payment, contract } from '../db/schema.js';
import { AppError } from '../errors.js';

export interface PaymentInput {
  contractId?: string | null;
  amount: number;
  paidAt: string;
  counterparty?: string | null;
  counterpartyAccount?: string | null;
  externalId?: string | null;
  statementRef?: string | null;
  source: 'bank' | 'manual';
  description?: string | null;
  note?: string | null;
}

export interface PaymentRow {
  id: string;
  orgId: string;
  contractId: string | null;
  amount: number;
  paidAt: string;
  counterparty: string | null;
  counterpartyAccount: string | null;
  externalId: string | null;
  statementRef: string | null;
  source: 'bank' | 'manual';
  description: string | null;
  note: string | null;
  importedAt: Date;
  createdAt: Date;
}

async function verifyContractInOrgIfSet(db: DB, orgId: string, contractId: string | null | undefined, allowedPropertyIds: string[] | null) {
  if (!contractId) return;
  const [c] = await db.select().from(contract).where(and(eq(contract.id, contractId), eq(contract.orgId, orgId)));
  if (!c) throw new AppError('not_found', 'contract not in org');
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(c.propertyId)) {
    throw new AppError('forbidden', 'no access to contract\'s property');
  }
}

export async function recordPayment(db: DB, orgId: string, allowedPropertyIds: string[] | null, input: PaymentInput): Promise<PaymentRow> {
  await verifyContractInOrgIfSet(db, orgId, input.contractId, allowedPropertyIds);
  // Idempotency on externalId
  if (input.externalId) {
    const existing = await db.select().from(payment).where(and(eq(payment.orgId, orgId), eq(payment.externalId, input.externalId))).then(rs => rs[0]);
    if (existing) return existing as PaymentRow;
  }
  const id = createId();
  const [row] = await db.insert(payment).values({
    id, orgId,
    contractId: input.contractId ?? null,
    amount: input.amount,
    paidAt: input.paidAt,
    counterparty: input.counterparty ?? null,
    counterpartyAccount: input.counterpartyAccount ?? null,
    externalId: input.externalId ?? null,
    statementRef: input.statementRef ?? null,
    source: input.source,
    description: input.description ?? null,
    note: input.note ?? null,
  }).returning();
  return row! as PaymentRow;
}

export const PAYMENT_BATCH_MAX = 500;

export async function recordPaymentsBatch(db: DB, orgId: string, allowedPropertyIds: string[] | null, inputs: PaymentInput[]): Promise<{ created: PaymentRow[]; existing: PaymentRow[] }> {
  if (inputs.length > PAYMENT_BATCH_MAX) {
    throw new AppError('bad_request', `batch size ${inputs.length} exceeds max ${PAYMENT_BATCH_MAX}`);
  }
  // Whole batch is one transaction — failure on any item rolls back the rest,
  // so we never leave partial state when a verification error fires mid-loop.
  return db.transaction(async (tx) => {
    const created: PaymentRow[] = [];
    const existing: PaymentRow[] = [];
    for (const input of inputs) {
      await verifyContractInOrgIfSet(tx, orgId, input.contractId, allowedPropertyIds);
      if (input.externalId) {
        const found = await tx.select().from(payment).where(and(eq(payment.orgId, orgId), eq(payment.externalId, input.externalId))).then(rs => rs[0]);
        if (found) {
          existing.push(found as PaymentRow);
          continue;
        }
      }
      const id = createId();
      const [row] = await tx.insert(payment).values({
        id, orgId,
        contractId: input.contractId ?? null,
        amount: input.amount,
        paidAt: input.paidAt,
        counterparty: input.counterparty ?? null,
        counterpartyAccount: input.counterpartyAccount ?? null,
        externalId: input.externalId ?? null,
        statementRef: input.statementRef ?? null,
        source: input.source,
        description: input.description ?? null,
        note: input.note ?? null,
      }).returning();
      created.push(row! as PaymentRow);
    }
    return { created, existing };
  });
}

export interface ListFilters {
  contractId?: string;
  unassigned?: boolean;
  from?: string;
  to?: string;
}

export async function listPayments(db: DB, orgId: string, allowedPropertyIds: string[] | null, filters: ListFilters): Promise<PaymentRow[]> {
  const conds = [eq(payment.orgId, orgId)];
  if (filters.contractId) conds.push(eq(payment.contractId, filters.contractId));
  if (filters.unassigned) conds.push(isNull(payment.contractId));
  if (filters.from) conds.push(gte(payment.paidAt, filters.from));
  if (filters.to) conds.push(lte(payment.paidAt, filters.to));
  let rows = await db.select().from(payment).where(and(...conds)).orderBy(desc(payment.paidAt));
  if (allowedPropertyIds !== null) {
    // restrict to payments whose contract belongs to allowed property OR unassigned
    const contractRows = await db.select().from(contract).where(eq(contract.orgId, orgId));
    const allowedContractIds = new Set(contractRows.filter(c => allowedPropertyIds.includes(c.propertyId)).map(c => c.id));
    rows = rows.filter(p => p.contractId === null || allowedContractIds.has(p.contractId));
  }
  return rows as PaymentRow[];
}

export async function getPayment(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<PaymentRow> {
  const [row] = await db.select().from(payment).where(and(eq(payment.id, id), eq(payment.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'payment not found');
  if (allowedPropertyIds !== null && row.contractId !== null) {
    const [c] = await db.select().from(contract).where(eq(contract.id, row.contractId));
    if (!c || !allowedPropertyIds.includes(c.propertyId)) {
      throw new AppError('forbidden', 'no access to payment\'s contract');
    }
  }
  return row as PaymentRow;
}

export async function assignPaymentToContract(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null, contractId: string | null): Promise<PaymentRow> {
  const existing = await getPayment(db, orgId, id, allowedPropertyIds);
  await verifyContractInOrgIfSet(db, orgId, contractId, allowedPropertyIds);
  const [row] = await db.update(payment).set({ contractId }).where(and(eq(payment.id, id), eq(payment.orgId, orgId))).returning();
  return row! as PaymentRow;
}

export async function updatePayment(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null, patch: Partial<Omit<PaymentInput, 'externalId'>>): Promise<PaymentRow> {
  await getPayment(db, orgId, id, allowedPropertyIds);
  if (patch.contractId !== undefined) await verifyContractInOrgIfSet(db, orgId, patch.contractId, allowedPropertyIds);
  const cleaned: Record<string, unknown> = {};
  for (const key of ['contractId', 'amount', 'paidAt', 'counterparty', 'counterpartyAccount', 'statementRef', 'description', 'note'] as const) {
    if ((patch as any)[key] !== undefined) cleaned[key] = (patch as any)[key];
  }
  if (Object.keys(cleaned).length === 0) return getPayment(db, orgId, id, allowedPropertyIds);
  const [row] = await db.update(payment).set(cleaned).where(and(eq(payment.id, id), eq(payment.orgId, orgId))).returning();
  return row! as PaymentRow;
}

export async function deletePayment(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<void> {
  await getPayment(db, orgId, id, allowedPropertyIds);
  await db.delete(payment).where(and(eq(payment.id, id), eq(payment.orgId, orgId)));
}
