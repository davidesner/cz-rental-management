import { createId } from '@paralleldrive/cuid2';
import { and, eq, isNull, gte, lte, desc, inArray } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { payment, contract, property, tenant } from '../db/schema.js';
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
  propertyName: string | null;
  tenantName: string | null;
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
    // The found row's real contractId can differ from input.contractId (a
    // caller-controlled value already checked above) — externalId matching
    // ignores contractId entirely. Re-fetch through getPayment passing the
    // caller's own allowedPropertyIds, so access is checked against the row
    // that's actually returned, not the one the caller merely asked for.
    // getPayment throws AppError('forbidden', "no access to payment's
    // contract") when it fails, same as any other read of this row.
    if (existing) return getPayment(db, orgId, existing.id, allowedPropertyIds);
  }
  const id = createId();
  await db.insert(payment).values({
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
  });
  // Ownership/access was already verified above via verifyContractInOrgIfSet,
  // and .insert().returning() wouldn't include the joined names — re-fetch
  // through getPayment instead, mirroring core/services/contract.ts#createContract.
  return getPayment(db, orgId, id, null);
}

export const PAYMENT_BATCH_MAX = 500;

export async function recordPaymentsBatch(db: DB, orgId: string, allowedPropertyIds: string[] | null, inputs: PaymentInput[]): Promise<{ created: PaymentRow[]; existing: PaymentRow[] }> {
  if (inputs.length > PAYMENT_BATCH_MAX) {
    throw new AppError('bad_request', `batch size ${inputs.length} exceeds max ${PAYMENT_BATCH_MAX}`);
  }
  // Whole batch is one transaction — failure on any item rolls back the rest,
  // so we never leave partial state when a verification error fires mid-loop.
  return db.transaction(async (tx) => {
    // Track ids in loop order instead of re-fetching (with the joined names)
    // one row at a time — that would add a query per input, which matters at
    // PAYMENT_BATCH_MAX (500). A single batched re-fetch below costs one
    // extra query for the whole call instead of N.
    const createdIds: string[] = [];
    const existingIds: string[] = [];
    for (const input of inputs) {
      await verifyContractInOrgIfSet(tx, orgId, input.contractId, allowedPropertyIds);
      if (input.externalId) {
        const found = await tx.select({ id: payment.id }).from(payment).where(and(eq(payment.orgId, orgId), eq(payment.externalId, input.externalId))).then(rs => rs[0]);
        if (found) {
          existingIds.push(found.id);
          continue;
        }
      }
      const id = createId();
      await tx.insert(payment).values({
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
      });
      createdIds.push(id);
    }
    if (createdIds.length === 0 && existingIds.length === 0) return { created: [], existing: [] };
    // Access for createdIds was already verified above via
    // verifyContractInOrgIfSet against the caller-supplied contractId that
    // was actually inserted, so those rows are safe as-is. existingIds rows
    // are different: externalId matching ignores input.contractId entirely,
    // so the row found may be assigned to a contract the caller never had
    // checked — same gap as recordPayment's idempotent branch. Check each
    // existingIds row's *actual* contractPropertyId below, one query for the
    // whole batch rather than a per-row re-fetch (stays N+1-free even at
    // PAYMENT_BATCH_MAX).
    const rows = await tx
      .select(paymentSelect)
      .from(payment)
      .leftJoin(contract, and(eq(contract.id, payment.contractId), eq(contract.orgId, payment.orgId)))
      .leftJoin(property, eq(property.id, contract.propertyId))
      .leftJoin(tenant, eq(tenant.id, contract.tenantId))
      .where(inArray(payment.id, [...createdIds, ...existingIds]));
    const byId = new Map(rows.map(r => [r.id, r]));
    if (allowedPropertyIds !== null) {
      for (const id of existingIds) {
        const row = byId.get(id)!;
        if (row.contractId !== null
            && (row.contractPropertyId === null || !allowedPropertyIds.includes(row.contractPropertyId))) {
          throw new AppError('forbidden', 'no access to payment\'s contract');
        }
      }
    }
    const strip = (id: string): PaymentRow => {
      const { contractPropertyId: _ignored, ...row } = byId.get(id)!;
      return row;
    };
    return { created: createdIds.map(strip), existing: existingIds.map(strip) };
  });
}

export interface ListFilters {
  contractId?: string;
  unassigned?: boolean;
  from?: string;
  to?: string;
}

// payment.contractId is nullable (ON DELETE set null), so these are leftJoins
// and the names are nullable — an unassigned payment has no contract, and must
// still appear in the list.
const paymentSelect = {
  id: payment.id,
  orgId: payment.orgId,
  contractId: payment.contractId,
  amount: payment.amount,
  paidAt: payment.paidAt,
  counterparty: payment.counterparty,
  counterpartyAccount: payment.counterpartyAccount,
  externalId: payment.externalId,
  statementRef: payment.statementRef,
  source: payment.source,
  description: payment.description,
  note: payment.note,
  importedAt: payment.importedAt,
  createdAt: payment.createdAt,
  propertyName: property.name,
  tenantName: tenant.name,
  contractPropertyId: contract.propertyId,
};

export async function listPayments(db: DB, orgId: string, allowedPropertyIds: string[] | null, filters: ListFilters): Promise<PaymentRow[]> {
  const conds = [eq(payment.orgId, orgId)];
  if (filters.contractId) conds.push(eq(payment.contractId, filters.contractId));
  if (filters.unassigned) conds.push(isNull(payment.contractId));
  if (filters.from) conds.push(gte(payment.paidAt, filters.from));
  if (filters.to) conds.push(lte(payment.paidAt, filters.to));
  const rows = await db
    .select(paymentSelect)
    .from(payment)
    .leftJoin(contract, and(eq(contract.id, payment.contractId), eq(contract.orgId, payment.orgId)))
    .leftJoin(property, eq(property.id, contract.propertyId))
    .leftJoin(tenant, eq(tenant.id, contract.tenantId))
    .where(and(...conds))
    .orderBy(desc(payment.paidAt));
  const visible = allowedPropertyIds === null
    ? rows
    // Unassigned payments stay visible to everyone. An ASSIGNED payment is
    // visible only if its contract resolves to an allowed property — this must
    // mirror getPayment's guard exactly, or the same row is listed here and
    // 403s on read. Keying on contractPropertyId alone was not enough: a
    // payment whose contract does not join (a different org) yields a null
    // property id with a non-null contractId, and was being shown to everyone.
    : rows.filter(r => r.contractId === null
        || (r.contractPropertyId !== null && allowedPropertyIds.includes(r.contractPropertyId)));
  return visible.map(({ contractPropertyId: _ignored, ...row }) => row);
}

export async function getPayment(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<PaymentRow> {
  const [row] = await db
    .select(paymentSelect)
    .from(payment)
    .leftJoin(contract, and(eq(contract.id, payment.contractId), eq(contract.orgId, payment.orgId)))
    .leftJoin(property, eq(property.id, contract.propertyId))
    .leftJoin(tenant, eq(tenant.id, contract.tenantId))
    .where(and(eq(payment.id, id), eq(payment.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'payment not found');
  // Same rule and same message as before the join: only assigned payments are
  // access-checked. The error text is asserted by
  // tests/payments.test.ts's "member restricted to one property is denied
  // access to another property's payment via idempotent externalId match"
  // regression test.
  if (allowedPropertyIds !== null && row.contractId !== null
      && (row.contractPropertyId === null || !allowedPropertyIds.includes(row.contractPropertyId))) {
    throw new AppError('forbidden', 'no access to payment\'s contract');
  }
  const { contractPropertyId: _ignored, ...rest } = row;
  return rest;
}

export async function assignPaymentToContract(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null, contractId: string | null): Promise<PaymentRow> {
  await getPayment(db, orgId, id, allowedPropertyIds);
  await verifyContractInOrgIfSet(db, orgId, contractId, allowedPropertyIds);
  await db.update(payment).set({ contractId }).where(and(eq(payment.id, id), eq(payment.orgId, orgId)));
  // Access already verified above (existing payment + new contractId), and
  // .update().returning() wouldn't include the joined names — re-fetch
  // through getPayment instead, mirroring core/services/contract.ts#updateContract.
  return getPayment(db, orgId, id, allowedPropertyIds);
}

export async function updatePayment(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null, patch: Partial<Omit<PaymentInput, 'externalId'>>): Promise<PaymentRow> {
  await getPayment(db, orgId, id, allowedPropertyIds);
  if (patch.contractId !== undefined) await verifyContractInOrgIfSet(db, orgId, patch.contractId, allowedPropertyIds);
  const cleaned: Record<string, unknown> = {};
  for (const key of ['contractId', 'amount', 'paidAt', 'counterparty', 'counterpartyAccount', 'statementRef', 'description', 'note'] as const) {
    if ((patch as any)[key] !== undefined) cleaned[key] = (patch as any)[key];
  }
  if (Object.keys(cleaned).length === 0) return getPayment(db, orgId, id, allowedPropertyIds);
  await db.update(payment).set(cleaned).where(and(eq(payment.id, id), eq(payment.orgId, orgId)));
  // Access already verified above, and .update().returning() wouldn't include
  // the joined names — re-fetch through getPayment instead, mirroring
  // core/services/contract.ts#updateContract.
  return getPayment(db, orgId, id, allowedPropertyIds);
}

export async function deletePayment(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<void> {
  await getPayment(db, orgId, id, allowedPropertyIds);
  await db.delete(payment).where(and(eq(payment.id, id), eq(payment.orgId, orgId)));
}
