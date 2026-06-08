import { createId } from '@paralleldrive/cuid2';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { reconciliation, reconciliationItem, contract, contractTerms, contractUtility, payment, costStatement, rentReduction } from '../db/schema.js';
import { AppError } from '../errors.js';
import { expectedForMonth, allocate, UTILITY_ORDER, type UtilityKind } from '../lib/allocation.js';
import { matchPayments, computeDueDate, type MonthSlot } from '../lib/payment-matching.js';

type Kind = 'rent' | 'services' | UtilityKind;

export interface ItemBreakdown {
  costStatements: Array<{
    id: string;
    periodFrom: string;
    periodTo: string;
    totalAmount: number;
    adjustmentAmount: number;
    adjustmentNote: string | null;
    note: string | null;
    documentRef: string | null;
  }>;
  months: Array<{
    month: string;           // "YYYY-MM"
    daysActive: number;
    daysInMonth: number;
    expectedThisKind: number;  // haléře
    expectedTotal: number;     // haléře (baseRent + service + all utilities, prorated)
    receivedTotal: number;     // haléře (sum of payment amounts in this month)
    paidThisKind: number;      // haléře (after allocation rule)
  }>;
}

export interface ReconciliationItemRow {
  id: string;
  reconciliationId: string;
  kind: Kind;
  actualCost: number;
  paid: number;
  difference: number;
  breakdown: ItemBreakdown;
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

export interface ReconciliationListRow extends ReconciliationRow {
  costStatementNotes: string[];
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

/**
 * Core computation: given a contract + its temporal/payment/cost-statement data,
 * compute items with full breakdown. Does not touch the DB.
 */
function computeItemsWithBreakdown(
  contractRow: { id: string; startDate: string; endDate: string | null; paymentDueDay: number; paymentAppliesTo: string },
  periodFrom: string,
  periodTo: string,
  terms: Array<{ validFrom: string; validTo: string | null; baseRent: number; serviceAdvance: number }>,
  utilities: Array<{ kind: string; validFrom: string; validTo: string | null; monthlyAdvance: number }>,
  payments: Array<{ id: string; amount: number; paidAt: string }>,
  reductions: Array<{ forMonth: string; amount: number }>,
  statements: Array<{
    id: string;
    kind: string;
    periodFrom: string;
    periodTo: string;
    totalAmount: number;
    adjustmentAmount: number;
    adjustmentNote: string | null;
    note: string | null;
    documentRef: string | null;
  }>,
): Array<{ kind: Kind; actualCost: number; paid: number; difference: number; breakdown: ItemBreakdown }> {

  const paymentDueDay = contractRow.paymentDueDay;
  const paymentAppliesTo = contractRow.paymentAppliesTo as 'current' | 'next';

  // Build month slots for FIFO matching
  const slots: MonthSlot[] = [];
  for (const { year, month } of eachMonthInPeriod(periodFrom, periodTo)) {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const monthFirst = `${monthStr}-01`;
    const exp = expectedForMonth(
      year, month,
      contractRow.startDate, contractRow.endDate,
      terms.map(t => ({ validFrom: t.validFrom, validTo: t.validTo, baseRent: t.baseRent, serviceAdvance: t.serviceAdvance })),
      utilities.map(u => ({ kind: u.kind as UtilityKind, validFrom: u.validFrom, validTo: u.validTo, monthlyAdvance: u.monthlyAdvance })),
    );
    const reduction = reductions.find(r => r.forMonth === monthFirst);
    const expectedTotal = exp.baseRent + exp.serviceAdvance + UTILITY_ORDER.reduce((s, k) => s + exp.utilities[k], 0);
    const rentReductionAmt = reduction?.amount ?? 0;
    const dueDate = computeDueDate(monthStr, paymentDueDay, paymentAppliesTo);
    slots.push({
      month: monthStr,
      expected: exp,
      effectiveExpected: expectedTotal - rentReductionAmt,
      rentReduction: rentReductionAmt,
      dueDate,
    });
  }

  // FIFO match — precompute naturalMonth per payment based on contract paymentAppliesTo
  const offsetMonths = paymentAppliesTo === 'next' ? 1 : 0;
  const paymentRefs = payments.map(p => {
    const [yy, mm] = p.paidAt.split('-').map(Number) as [number, number, number];
    let nm = mm + offsetMonths;
    let ny = yy;
    if (nm > 12) { nm = nm - 12; ny += 1; }
    const naturalMonth = `${ny}-${String(nm).padStart(2, '0')}`;
    return { id: p.id, amount: p.amount, paidAt: p.paidAt, naturalMonth };
  });
  const { perMonth } = matchPayments(slots, paymentRefs);

  const paidPerKind: Record<Kind, number> = {
    rent: 0, services: 0, electricity: 0, gas: 0, internet: 0, water: 0, other: 0,
  };

  // For rent we also accumulate the expected (since there's no cost statement for rent —
  // "actualCost" = what tenant was supposed to pay = baseRent − rentReduction summed)
  let rentExpectedTotal = 0;

  // monthsPerKind collects per-month data keyed by kind
  const monthsPerKind: Record<Kind, ItemBreakdown['months']> = {
    rent: [], services: [], electricity: [], gas: [], internet: [], water: [], other: [],
  };

  for (const slot of slots) {
    const match = perMonth[slot.month]!;
    const received = match.receivedTotal;
    const exp = slot.expected;
    // Apply rentReduction to baseRent for allocation purposes — tenant's effective rent
    // obligation that month is baseRent − srážka. Rent-first allocation fills this reduced
    // amount; the rest flows to services/utilities.
    const rentEffective = Math.max(0, exp.baseRent - slot.rentReduction);
    const effectiveExp = { ...exp, baseRent: rentEffective };
    const a = allocate(received, effectiveExp);

    paidPerKind.rent += a.baseRentPaid;
    paidPerKind.services += a.servicePaid;
    for (const kind of UTILITY_ORDER) paidPerKind[kind] += a.utilityPaid[kind];

    rentExpectedTotal += rentEffective;

    const expectedTotal = exp.baseRent + exp.serviceAdvance + UTILITY_ORDER.reduce((s, k) => s + exp.utilities[k], 0);

    // rent
    monthsPerKind.rent.push({
      month: slot.month,
      daysActive: exp.daysActive,
      daysInMonth: exp.daysInMonth,
      expectedThisKind: rentEffective,
      expectedTotal,
      receivedTotal: received,
      paidThisKind: a.baseRentPaid,
    });

    // services
    monthsPerKind.services.push({
      month: slot.month,
      daysActive: exp.daysActive,
      daysInMonth: exp.daysInMonth,
      expectedThisKind: exp.serviceAdvance,
      expectedTotal,
      receivedTotal: received,
      paidThisKind: a.servicePaid,
    });

    // utilities
    for (const kind of UTILITY_ORDER) {
      monthsPerKind[kind].push({
        month: slot.month,
        daysActive: exp.daysActive,
        daysInMonth: exp.daysInMonth,
        expectedThisKind: exp.utilities[kind],
        expectedTotal,
        receivedTotal: received,
        paidThisKind: a.utilityPaid[kind],
      });
    }
  }

  // Group cost statements by kind
  const statementsPerKind: Record<Kind, ItemBreakdown['costStatements']> = {
    rent: [], services: [], electricity: [], gas: [], internet: [], water: [], other: [],
  };
  const costPerKind: Record<Kind, number> = {
    // For rent: "cost" is the effective expected (what tenant was supposed to pay).
    // No cost statements apply.
    rent: rentExpectedTotal,
    services: 0, electricity: 0, gas: 0, internet: 0, water: 0, other: 0,
  };
  for (const s of statements) {
    const k = s.kind as Kind;
    statementsPerKind[k].push({
      id: s.id,
      periodFrom: s.periodFrom,
      periodTo: s.periodTo,
      totalAmount: s.totalAmount,
      adjustmentAmount: s.adjustmentAmount,
      adjustmentNote: s.adjustmentNote,
      note: s.note,
      documentRef: s.documentRef,
    });
    costPerKind[k] += s.totalAmount + s.adjustmentAmount;
  }

  // Build items for any kind with non-zero paid OR cost (rent first)
  const kindsToShow: Kind[] = ['rent', 'services', ...UTILITY_ORDER];
  const result: Array<{ kind: Kind; actualCost: number; paid: number; difference: number; breakdown: ItemBreakdown }> = [];
  for (const kind of kindsToShow) {
    const actual = costPerKind[kind];
    const paid = paidPerKind[kind];
    if (actual === 0 && paid === 0) continue;
    result.push({
      kind,
      actualCost: actual,
      paid,
      difference: paid - actual,
      breakdown: {
        costStatements: statementsPerKind[kind],
        months: monthsPerKind[kind],
      },
    });
  }
  return result;
}

/**
 * Load all data needed to compute items+breakdown for a given contract and period,
 * then run the pure computation.
 */
async function buildItemsWithBreakdown(
  db: DB,
  contractRow: { id: string; orgId: string; propertyId: string; startDate: string; endDate: string | null; paymentDueDay: number; paymentAppliesTo: string },
  periodFrom: string,
  periodTo: string,
  placeholderRecId: string,
): Promise<Array<ReconciliationItemRow>> {
  const terms = await db.select().from(contractTerms)
    .where(eq(contractTerms.contractId, contractRow.id))
    .orderBy(asc(contractTerms.validFrom));

  const utilities = await db.select().from(contractUtility)
    .where(eq(contractUtility.contractId, contractRow.id))
    .orderBy(asc(contractUtility.validFrom));

  const payments = await db.select().from(payment).where(
    and(eq(payment.contractId, contractRow.id), gte(payment.paidAt, periodFrom), lte(payment.paidAt, periodTo))
  );

  const reductions = await db.select().from(rentReduction).where(
    eq(rentReduction.contractId, contractRow.id)
  );

  const statements = await db.select().from(costStatement).where(
    and(
      eq(costStatement.orgId, contractRow.orgId),
      eq(costStatement.propertyId, contractRow.propertyId),
      lte(costStatement.periodFrom, periodTo),
      gte(costStatement.periodTo, periodFrom),
    ),
  );

  const computed = computeItemsWithBreakdown(contractRow, periodFrom, periodTo, terms, utilities, payments, reductions, statements);

  return computed.map(item => ({
    id: createId(),
    reconciliationId: placeholderRecId,
    kind: item.kind,
    actualCost: item.actualCost,
    paid: item.paid,
    difference: item.difference,
    breakdown: item.breakdown,
  }));
}

export async function computeReconciliation(
  db: DB,
  orgId: string,
  contractId: string,
  allowedPropertyIds: string[] | null,
  input: { periodFrom: string; periodTo: string; note?: string | null }
): Promise<ReconciliationRow> {
  const c = await assertContract(db, orgId, contractId, allowedPropertyIds);

  const recId = createId();
  const itemsWithBreakdown = await buildItemsWithBreakdown(db, c, input.periodFrom, input.periodTo, recId);

  // Persist in a transaction (store simplified rows — no breakdown in DB)
  const result = await db.transaction(async (tx) => {
    const [rec] = await tx.insert(reconciliation).values({
      id: recId, orgId, contractId,
      periodFrom: input.periodFrom, periodTo: input.periodTo,
      status: 'draft', note: input.note ?? null,
    }).returning();
    if (itemsWithBreakdown.length > 0) {
      await tx.insert(reconciliationItem).values(
        itemsWithBreakdown.map(({ id, reconciliationId, kind, actualCost, paid, difference }) => ({
          id, reconciliationId, kind, actualCost, paid, difference,
        }))
      );
    }
    return rec!;
  });

  return { ...result, items: itemsWithBreakdown };
}

export async function listReconciliations(
  db: DB,
  orgId: string,
  contractId: string | undefined,
  allowedPropertyIds: string[] | null
): Promise<ReconciliationListRow[]> {
  const conds = [eq(reconciliation.orgId, orgId)];
  if (contractId) conds.push(eq(reconciliation.contractId, contractId));
  const rows = await db.select().from(reconciliation).where(and(...conds));

  // Pre-load contracts to get propertyIds
  const contractRows = await db.select().from(contract).where(eq(contract.orgId, orgId));
  const contractMap = Object.fromEntries(contractRows.map(c => [c.id, c]));

  let filteredRows = rows;
  if (allowedPropertyIds !== null) {
    const allowedContractIds = new Set(
      contractRows.filter(c => allowedPropertyIds.includes(c.propertyId)).map(c => c.id)
    );
    filteredRows = rows.filter(r => allowedContractIds.has(r.contractId));
  }

  return Promise.all(filteredRows.map(async r => {
    const items = (await db.select().from(reconciliationItem).where(eq(reconciliationItem.reconciliationId, r.id))) as Omit<ReconciliationItemRow, 'breakdown'>[];

    // Collect costStatementNotes for this reconciliation's contract/property
    const c = contractMap[r.contractId];
    let costStatementNotes: string[] = [];
    if (c) {
      const stmts = await db.select({ adjustmentNote: costStatement.adjustmentNote }).from(costStatement).where(
        and(
          eq(costStatement.orgId, orgId),
          eq(costStatement.propertyId, c.propertyId),
          lte(costStatement.periodFrom, r.periodTo),
          gte(costStatement.periodTo, r.periodFrom),
        ),
      );
      costStatementNotes = stmts
        .map(s => s.adjustmentNote)
        .filter((n): n is string => n !== null && n.trim() !== '');
    }

    // Items in list don't include breakdown — add empty breakdown placeholder
    const itemsWithBreakdown: ReconciliationItemRow[] = (items as Array<Omit<ReconciliationItemRow, 'breakdown'>>).map(item => ({
      ...item,
      breakdown: { costStatements: [], months: [] },
    }));

    return { ...r, items: itemsWithBreakdown, costStatementNotes };
  }));
}

export async function getReconciliation(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<ReconciliationRow> {
  const [row] = await db.select().from(reconciliation).where(and(eq(reconciliation.id, id), eq(reconciliation.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'reconciliation not found');
  const c = await assertContract(db, orgId, row.contractId, allowedPropertyIds);

  // Fetch the persisted snapshot (actualCost/paid/difference from time of last compute/recompute)
  const persistedItems = await db.select().from(reconciliationItem)
    .where(eq(reconciliationItem.reconciliationId, id));

  // Also recompute LIVE breakdown reflecting current cost statements / payments / reductions
  const liveItems = await buildItemsWithBreakdown(db, c, row.periodFrom, row.periodTo, id);

  // Merge: items use PERSISTED actualCost/paid/difference (the snapshot) and attach the
  // current LIVE breakdown so the UI can compare snapshot vs current state for the badge.
  // If a kind exists in live but not persisted (e.g. new cost statement was added after compute),
  // include it with persisted values 0 — UI will show divergence.
  const liveByKind = new Map(liveItems.map((it) => [it.kind, it]));
  const persistedKinds = new Set(persistedItems.map((p) => p.kind as Kind));

  const items: ReconciliationItemRow[] = persistedItems.map((p) => {
    const live = liveByKind.get(p.kind as Kind);
    return {
      id: p.id,
      reconciliationId: p.reconciliationId,
      kind: p.kind as Kind,
      actualCost: p.actualCost,
      paid: p.paid,
      difference: p.difference,
      breakdown: live?.breakdown ?? { costStatements: [], months: [] },
    };
  });
  // Append any "new" kinds (appeared after compute) as zero-snapshot rows
  for (const live of liveItems) {
    if (!persistedKinds.has(live.kind)) {
      items.push({
        id: live.id,
        reconciliationId: id,
        kind: live.kind,
        actualCost: 0,
        paid: 0,
        difference: 0,
        breakdown: live.breakdown,
      });
    }
  }

  return { ...row, items };
}

export async function finalizeReconciliation(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<ReconciliationRow> {
  const existing = await getReconciliation(db, orgId, id, allowedPropertyIds);
  if (existing.status === 'finalized') return existing;
  await db.update(reconciliation).set({ status: 'finalized' }).where(and(eq(reconciliation.id, id), eq(reconciliation.orgId, orgId)));
  return getReconciliation(db, orgId, id, allowedPropertyIds);
}

export async function deleteReconciliation(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<void> {
  await getReconciliation(db, orgId, id, allowedPropertyIds);
  await db.delete(reconciliation).where(and(eq(reconciliation.id, id), eq(reconciliation.orgId, orgId)));
}

export async function recomputeReconciliation(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<ReconciliationRow> {
  const existing = await getReconciliation(db, orgId, id, allowedPropertyIds);

  const c = await assertContract(db, orgId, existing.contractId, allowedPropertyIds);
  const freshItems = await buildItemsWithBreakdown(db, c, existing.periodFrom, existing.periodTo, id);

  await db.transaction(async (tx) => {
    await tx.delete(reconciliationItem).where(eq(reconciliationItem.reconciliationId, id));
    if (freshItems.length > 0) {
      await tx.insert(reconciliationItem).values(
        freshItems.map(({ id: itemId, reconciliationId, kind, actualCost, paid, difference }) => ({
          id: itemId, reconciliationId, kind, actualCost, paid, difference,
        }))
      );
    }
    await tx.update(reconciliation)
      .set({ computedAt: new Date() })
      .where(and(eq(reconciliation.id, id), eq(reconciliation.orgId, orgId)));
  });

  return { ...existing, computedAt: new Date(), items: freshItems };
}
