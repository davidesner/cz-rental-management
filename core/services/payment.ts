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
  /**
   * The bank symbols a payment_matching_rule filters on. Optional everywhere:
   * a hand-entered payment has none, and every caller predating these columns
   * keeps working by omitting them.
   */
  vs?: string | null;
  ks?: string | null;
  ss?: string | null;
  externalId?: string | null;
  statementRef?: string | null;
  source: 'bank' | 'manual';
  description?: string | null;
  note?: string | null;
  /**
   * Force creation of a payment that duplicate detection would otherwise
   * refuse. Only ever set after a human has confirmed this really is a second,
   * separate transfer — never as a way to make an error go away.
   */
  allowDuplicate?: boolean;
}

export interface PaymentRow {
  id: string;
  orgId: string;
  contractId: string | null;
  amount: number;
  paidAt: string;
  counterparty: string | null;
  counterpartyAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
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

/**
 * Is this same money already recorded on this contract?
 *
 * The fingerprint is orgId + contractId + amount + paidAt, and it is
 * deliberately NOT externalId — the two answer different questions:
 *
 * - Same `externalId` means "the same source record, retried". Idempotent
 *   success is right; the caller learns nothing from an error.
 * - Same fingerprint with a DIFFERENT `externalId` means a different source
 *   record claims the same money — two channels disagreeing about whether this
 *   transfer has been accounted for. There is no default the service can pick
 *   that is safe, which is why the single-write path throws.
 *
 * Why exactly these three columns:
 *
 * - `contractId` must be non-null. An unassigned payment has no contract to
 *   fingerprint against, so those are never treated as duplicates.
 * - The counterparty account is NOT in the key, even though it would narrow it:
 *   `payment.counterpartyAccount` is nullable and is routinely null on a
 *   hand-entered row. Three parameters that are always present beat four that
 *   sometimes are.
 * - Nor is the variable symbol, because `payment` has no vs/ks/ss columns at
 *   all — those live on `bank_transaction`. Contract + amount + date is what
 *   this table can support; nobody should read this and assume the symbol is
 *   being compared.
 */
export async function findPaymentByFingerprint(
  db: DB, orgId: string, contractId: string, amount: number, paidAt: string,
): Promise<{ id: string; source: 'bank' | 'manual'; vs: string | null } | null> {
  // `vs` is selected for the conflict MESSAGE only, never for the match: report
  // everything you know, match on what is always present.
  const [row] = await db.select({ id: payment.id, source: payment.source, vs: payment.vs }).from(payment).where(and(
    eq(payment.orgId, orgId),
    eq(payment.contractId, contractId),
    eq(payment.amount, amount),
    eq(payment.paidAt, paidAt),
  ));
  return row ?? null;
}

async function findDuplicateFor(db: DB, orgId: string, input: PaymentInput) {
  if (input.allowDuplicate) return null;
  if (!input.contractId) return null;
  return findPaymentByFingerprint(db, orgId, input.contractId, input.amount, input.paidAt);
}

/**
 * Says WHICH case this is, so the asymmetry with the externalId branch reads as
 * deliberate at the call site rather than as an inconsistency.
 */
function duplicateMessage(hit: { id: string; source: string; vs: string | null }, input: PaymentInput): string {
  const vs = hit.vs === null ? '' : `, VS ${hit.vs}`;
  return `na tomto pronájmu už je zapsaná platba ${(input.amount / 100).toLocaleString('cs-CZ')} Kč`
    + ` k datu ${input.paidAt} (${hit.id}, zdroj ${hit.source}${vs}) — shoda podle pronájmu, částky a data,`
    + ' ne podle externalId, takže jde o jiný záznam o stejných penězích.'
    + ' Pokud je to skutečně druhý samostatný převod, zapiš ho s allowDuplicate.';
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
  // NOT the branch above. That one is a retry of the same source record and
  // succeeds idempotently; this one is a DIFFERENT record claiming the same
  // money, and a single deliberate write deserves to be told there is a
  // decision to make rather than have one channel silently win.
  const duplicate = await findDuplicateFor(db, orgId, input);
  if (duplicate) throw new AppError('conflict', duplicateMessage(duplicate, input));
  const id = createId();
  await db.insert(payment).values({
    id, orgId,
    contractId: input.contractId ?? null,
    amount: input.amount,
    paidAt: input.paidAt,
    counterparty: input.counterparty ?? null,
    counterpartyAccount: input.counterpartyAccount ?? null,
    vs: input.vs ?? null,
    ks: input.ks ?? null,
    ss: input.ss ?? null,
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

/**
 * `existing` and `duplicates` are NOT the same thing and must stay apart:
 * `existing` means "same externalId — you already sent me this record", while
 * `duplicates` means "a DIFFERENT record already accounts for this money".
 * Conflating them would lose exactly the information the caller needs.
 *
 * Unlike recordPayment, a fingerprint match here does NOT throw. The whole batch
 * is one transaction, so a per-item throw would roll back every sibling and make
 * a statement import all-or-nothing on its noisiest row. Skip and report.
 */
export async function recordPaymentsBatch(db: DB, orgId: string, allowedPropertyIds: string[] | null, inputs: PaymentInput[]): Promise<{ created: PaymentRow[]; existing: PaymentRow[]; duplicates: PaymentRow[] }> {
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
    // The ids of the payments that ALREADY cover this money, same shape as
    // existingIds: what the caller needs is the row that blocked them.
    const duplicateIds: string[] = [];
    for (const input of inputs) {
      await verifyContractInOrgIfSet(tx, orgId, input.contractId, allowedPropertyIds);
      if (input.externalId) {
        const found = await tx.select({ id: payment.id }).from(payment).where(and(eq(payment.orgId, orgId), eq(payment.externalId, input.externalId))).then(rs => rs[0]);
        if (found) {
          existingIds.push(found.id);
          continue;
        }
      }
      // Reads inside the same transaction, so two identical inputs in ONE batch
      // are caught as well: the first insert is visible to the second's lookup.
      const duplicate = await findDuplicateFor(tx, orgId, input);
      if (duplicate) {
        duplicateIds.push(duplicate.id);
        continue;
      }
      const id = createId();
      await tx.insert(payment).values({
        id, orgId,
        contractId: input.contractId ?? null,
        amount: input.amount,
        paidAt: input.paidAt,
        counterparty: input.counterparty ?? null,
        counterpartyAccount: input.counterpartyAccount ?? null,
        vs: input.vs ?? null,
        ks: input.ks ?? null,
        ss: input.ss ?? null,
        externalId: input.externalId ?? null,
        statementRef: input.statementRef ?? null,
        source: input.source,
        description: input.description ?? null,
        note: input.note ?? null,
      });
      createdIds.push(id);
    }
    if (createdIds.length === 0 && existingIds.length === 0 && duplicateIds.length === 0) {
      return { created: [], existing: [], duplicates: [] };
    }
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
      .where(inArray(payment.id, [...createdIds, ...existingIds, ...duplicateIds]));
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
    // duplicateIds needs no extra access check, unlike existingIds: the
    // fingerprint includes input.contractId, which verifyContractInOrgIfSet
    // already validated for this caller, so the row found is on the caller's own
    // verified contract by construction.
    return { created: createdIds.map(strip), existing: existingIds.map(strip), duplicates: duplicateIds.map(strip) };
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
  vs: payment.vs,
  ks: payment.ks,
  ss: payment.ss,
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

export async function updatePayment(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null, patch: Partial<Omit<PaymentInput, 'externalId' | 'allowDuplicate'>>): Promise<PaymentRow> {
  await getPayment(db, orgId, id, allowedPropertyIds);
  if (patch.contractId !== undefined) await verifyContractInOrgIfSet(db, orgId, patch.contractId, allowedPropertyIds);
  const cleaned: Record<string, unknown> = {};
  for (const key of ['contractId', 'amount', 'paidAt', 'counterparty', 'counterpartyAccount', 'vs', 'ks', 'ss', 'statementRef', 'description', 'note'] as const) {
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
