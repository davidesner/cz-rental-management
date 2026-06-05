import { createId } from '@paralleldrive/cuid2';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { reconciliation, reconciliationItem, contract, contractTerms, contractUtility, payment, costStatement } from '../db/schema.js';
import { AppError } from '../errors.js';
import { expectedForMonth, allocate, UTILITY_ORDER, type UtilityKind } from '../lib/allocation.js';

type Kind = 'services' | UtilityKind;

export interface ReconciliationItemRow {
  id: string;
  reconciliationId: string;
  kind: Kind;
  actualCost: number;
  paid: number;
  difference: number;
}

export interface ReconciliationRow {
  id: string;
  orgId: string;
  contractId: string;
  periodFrom: string;
  periodTo: string;
  status: 'draft' | 'finalized';
  computedAt: Date;
  note: string | null;
  createdAt: Date;
  items: ReconciliationItemRow[];
}

async function assertContract(db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null) {
  const [c] = await db.select().from(contract).where(and(eq(contract.id, contractId), eq(contract.orgId, orgId)));
  if (!c) throw new AppError('not_found', 'contract not in org');
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(c.propertyId)) {
    throw new AppError('forbidden', 'no access');
  }
  return c;
}

function eachMonthInPeriod(periodFrom: string, periodTo: string): Array<{ year: number; month: number }> {
  const result: Array<{ year: number; month: number }> = [];
  const [y0, m0] = periodFrom.split('-').map(Number) as [number, number, number?];
  const [y1, m1] = periodTo.split('-').map(Number) as [number, number, number?];
  let y = y0, m = m0;
  while (y < y1 || (y === y1 && m <= m1)) {
    result.push({ year: y, month: m });
    m++;
    if (m > 12) { y++; m = 1; }
  }
  return result;
}

export async function computeReconciliation(
  db: DB,
  orgId: string,
  contractId: string,
  allowedPropertyIds: string[] | null,
  input: { periodFrom: string; periodTo: string; note?: string | null }
): Promise<ReconciliationRow> {
  const c = await assertContract(db, orgId, contractId, allowedPropertyIds);

  // Load temporal data
  const terms = await db.select().from(contractTerms).where(eq(contractTerms.contractId, contractId)).orderBy(asc(contractTerms.validFrom));
  const utilities = await db.select().from(contractUtility).where(eq(contractUtility.contractId, contractId)).orderBy(asc(contractUtility.validFrom));

  // Load payments in period
  const payments = await db.select().from(payment).where(
    and(eq(payment.contractId, contractId), gte(payment.paidAt, input.periodFrom), lte(payment.paidAt, input.periodTo))
  );

  // Accumulate paid per kind
  const paidPerKind: Record<Kind, number> = {
    services: 0, electricity: 0, gas: 0, internet: 0, water: 0, other: 0,
  };

  for (const { year, month } of eachMonthInPeriod(input.periodFrom, input.periodTo)) {
    const exp = expectedForMonth(
      year, month,
      c.startDate, c.endDate,
      terms.map(t => ({ validFrom: t.validFrom, validTo: t.validTo, baseRent: t.baseRent, serviceAdvance: t.serviceAdvance })),
      utilities.map(u => ({ kind: u.kind as UtilityKind, validFrom: u.validFrom, validTo: u.validTo, monthlyAdvance: u.monthlyAdvance })),
    );
    const monthFirst = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthLast = `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
    const received = payments
      .filter(p => p.paidAt >= monthFirst && p.paidAt <= monthLast)
      .reduce((s, p) => s + p.amount, 0);
    const a = allocate(received, exp);
    paidPerKind.services += a.servicePaid;
    for (const kind of UTILITY_ORDER) paidPerKind[kind] += a.utilityPaid[kind];
  }

  // Load cost statements that intersect the period
  const statements = await db.select().from(costStatement).where(
    and(
      eq(costStatement.orgId, orgId),
      eq(costStatement.propertyId, c.propertyId),
      lte(costStatement.periodFrom, input.periodTo),
      gte(costStatement.periodTo, input.periodFrom),
    ),
  );
  const costPerKind: Record<Kind, number> = {
    services: 0, electricity: 0, gas: 0, internet: 0, water: 0, other: 0,
  };
  for (const s of statements) {
    costPerKind[s.kind as Kind] += s.totalAmount + s.adjustmentAmount;
  }

  // Build items: include any kind where either side is non-zero
  const recId = createId();
  const itemRows: Array<typeof reconciliationItem.$inferInsert> = [];
  const kindsToShow: Kind[] = ['services', ...UTILITY_ORDER];
  for (const kind of kindsToShow) {
    const actual = costPerKind[kind];
    const paid = paidPerKind[kind];
    if (actual === 0 && paid === 0) continue;
    itemRows.push({
      id: createId(), reconciliationId: recId, kind,
      actualCost: actual, paid, difference: paid - actual,
    });
  }

  // Persist in a transaction
  const result = await db.transaction(async (tx) => {
    const [rec] = await tx.insert(reconciliation).values({
      id: recId, orgId, contractId,
      periodFrom: input.periodFrom, periodTo: input.periodTo,
      status: 'draft', note: input.note ?? null,
    }).returning();
    if (itemRows.length > 0) {
      await tx.insert(reconciliationItem).values(itemRows);
    }
    return rec!;
  });
  const items = await db.select().from(reconciliationItem).where(eq(reconciliationItem.reconciliationId, recId));
  return { ...result, items: items as ReconciliationItemRow[] };
}

export async function listReconciliations(db: DB, orgId: string, contractId: string | undefined, allowedPropertyIds: string[] | null): Promise<ReconciliationRow[]> {
  const conds = [eq(reconciliation.orgId, orgId)];
  if (contractId) conds.push(eq(reconciliation.contractId, contractId));
  const rows = await db.select().from(reconciliation).where(and(...conds));
  if (allowedPropertyIds !== null) {
    // restrict by contract's property
    const contractRows = await db.select().from(contract).where(eq(contract.orgId, orgId));
    const allowedContractIds = new Set(contractRows.filter(c => allowedPropertyIds.includes(c.propertyId)).map(c => c.id));
    const filtered = rows.filter(r => allowedContractIds.has(r.contractId));
    return Promise.all(filtered.map(async r => ({
      ...r,
      items: (await db.select().from(reconciliationItem).where(eq(reconciliationItem.reconciliationId, r.id))) as ReconciliationItemRow[],
    })));
  }
  return Promise.all(rows.map(async r => ({
    ...r,
    items: (await db.select().from(reconciliationItem).where(eq(reconciliationItem.reconciliationId, r.id))) as ReconciliationItemRow[],
  })));
}

export async function getReconciliation(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<ReconciliationRow> {
  const [row] = await db.select().from(reconciliation).where(and(eq(reconciliation.id, id), eq(reconciliation.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'reconciliation not found');
  await assertContract(db, orgId, row.contractId, allowedPropertyIds);
  const items = await db.select().from(reconciliationItem).where(eq(reconciliationItem.reconciliationId, id));
  return { ...row, items: items as ReconciliationItemRow[] };
}

export async function finalizeReconciliation(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<ReconciliationRow> {
  const existing = await getReconciliation(db, orgId, id, allowedPropertyIds);
  if (existing.status === 'finalized') return existing;
  await db.update(reconciliation).set({ status: 'finalized' }).where(and(eq(reconciliation.id, id), eq(reconciliation.orgId, orgId)));
  return getReconciliation(db, orgId, id, allowedPropertyIds);
}

export async function deleteReconciliation(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<void> {
  const existing = await getReconciliation(db, orgId, id, allowedPropertyIds);
  if (existing.status === 'finalized') throw new AppError('conflict', 'cannot delete finalized reconciliation');
  await db.delete(reconciliation).where(and(eq(reconciliation.id, id), eq(reconciliation.orgId, orgId)));
}
