import { createId } from '@paralleldrive/cuid2';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { reconciliation, reconciliationItem, contract, contractTerms, contractUtility, payment, costStatement, rentReduction } from '../db/schema.js';
import { AppError } from '../errors.js';
import { expectedForMonth, allocate, UTILITY_ORDER, type UtilityKind } from '../lib/allocation.js';
import { matchPayments, computeDueDate, type MonthSlot } from '../lib/payment-matching.js';
import { validAt } from '../lib/temporal.js';

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
  matchPeriod: { from: string; to: string };
  matchPeriodSource: 'default' | 'from-cost-statements';
  matchPeriodIsDifferentFromDefault: boolean;
  /** When auto-shift was applied (prior statement claimed boundary month), original (unshifted) start date. */
  matchPeriodNaturalFrom?: string;
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
 * Derive matchPeriod for a given kind.
 *
 * Candidates: cost statements of this kind whose periodFrom STARTS within
 * [reconPeriodFrom, reconPeriodTo] (inclusive on both ends).
 *
 * If candidates found: matchPeriod = (min(cs.periodFrom), max(cs.periodTo))
 * Otherwise: matchPeriod = (reconPeriodFrom, reconPeriodTo)  [default]
 *
 * AUTO-SHIFT for cross-year cycles: If a PRIOR statement of the same kind ends
 * in the same calendar month as our matchPeriod starts (e.g., prior ends 2025-02-14,
 * we start 2025-02-15), shift our matchPeriod start to the next month (2025-03-01)
 * to avoid double-counting that boundary month across two reconciliations.
 * `shiftedFromNatural` is populated when this happens, for UI tooltip use.
 */
function deriveMatchPeriod(
  kind: string,
  reconPeriodFrom: string,
  reconPeriodTo: string,
  statements: Array<{ kind: string; periodFrom: string; periodTo: string }>,
): { from: string; to: string; source: 'default' | 'from-cost-statements'; shiftedFromNatural?: string } {
  const sameKind = statements.filter(s => s.kind === kind);
  const candidates = sameKind.filter(
    s => s.periodFrom >= reconPeriodFrom && s.periodFrom <= reconPeriodTo
  );
  if (candidates.length === 0) {
    return { from: reconPeriodFrom, to: reconPeriodTo, source: 'default' };
  }
  const naturalFrom = candidates.reduce((min, s) => s.periodFrom < min ? s.periodFrom : min, candidates[0]!.periodFrom);
  const to = candidates.reduce((max, s) => s.periodTo > max ? s.periodTo : max, candidates[0]!.periodTo);

  // Detect overlap with a prior statement of the same kind that ends in our start month.
  const naturalFromMonth = naturalFrom.slice(0, 7);
  const priorOverlap = sameKind.find(
    s => s.periodFrom < naturalFrom && s.periodTo.slice(0, 7) === naturalFromMonth
  );
  if (priorOverlap) {
    // Shift to first day of NEXT month — that month belongs to the prior statement.
    const [y, m] = naturalFromMonth.split('-').map(Number) as [number, number];
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    const shifted = `${ny}-${String(nm).padStart(2, '0')}-01`;
    return { from: shifted, to, source: 'from-cost-statements', shiftedFromNatural: naturalFrom };
  }

  return { from: naturalFrom, to, source: 'from-cost-statements' };
}

/**
 * Core computation: given a contract + its temporal/payment/cost-statement data,
 * compute items with full breakdown. Does not touch the DB.
 */
function computeItemsWithBreakdown(
  contractRow: { id: string; startDate: string; endDate: string | null },
  periodFrom: string,
  periodTo: string,
  terms: Array<{ validFrom: string; validTo: string | null; baseRent: number; serviceAdvance: number; paymentDueDay: number; paymentAppliesTo: string }>,
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

  // Pick the terms valid on `refDate` (YYYY-MM-DD). Used both for slot dueDate
  // (refDate = month's 1st) and payment offset (refDate = paidAt).
  const termsAt = (refDate: string) => validAt(terms, refDate);

  // Pre-compute matchPeriod per kind so we know the UNION span. Slots & breakdown.months
  // must cover the union — otherwise kinds with matchPeriod extending past recon period
  // (e.g. electricity Feb 2024 - Feb 2025 in Jan-Dec 2024 recon) miss boundary months.
  const kindsToShow: Kind[] = ['rent', 'services', ...UTILITY_ORDER];
  const matchPeriodsPerKind = new Map<Kind, ReturnType<typeof deriveMatchPeriod>>();
  for (const kind of kindsToShow) {
    matchPeriodsPerKind.set(kind, deriveMatchPeriod(kind, periodFrom, periodTo, statements));
  }
  const unionFrom = [periodFrom, ...Array.from(matchPeriodsPerKind.values()).map(m => m.from)]
    .reduce((min, d) => d < min ? d : min);
  const unionTo = [periodTo, ...Array.from(matchPeriodsPerKind.values()).map(m => m.to)]
    .reduce((max, d) => d > max ? d : max);

  // Build month slots for FIFO matching — over union span
  const slots: MonthSlot[] = [];
  for (const { year, month } of eachMonthInPeriod(unionFrom, unionTo)) {
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
    // Read payment terms valid for this month (start-of-month)
    const t = termsAt(monthFirst);
    const slotPaymentDueDay = t?.paymentDueDay ?? 10;
    const slotPaymentAppliesTo = (t?.paymentAppliesTo as 'current' | 'next' | undefined) ?? 'current';
    const dueDate = computeDueDate(monthStr, slotPaymentDueDay, slotPaymentAppliesTo);
    slots.push({
      month: monthStr,
      expected: exp,
      effectiveExpected: expectedTotal - rentReductionAmt,
      rentReduction: rentReductionAmt,
      dueDate,
    });
  }

  // FIFO match — per-payment naturalMonth uses the terms valid at paidAt
  const paymentRefs = payments.map(p => {
    const t = termsAt(p.paidAt);
    const offset = ((t?.paymentAppliesTo as 'current' | 'next' | undefined) ?? 'current') === 'next' ? 1 : 0;
    const [yy, mm] = p.paidAt.split('-').map(Number) as [number, number, number];
    let nm = mm + offset;
    let ny = yy;
    if (nm > 12) { nm = nm - 12; ny += 1; }
    const naturalMonth = `${ny}-${String(nm).padStart(2, '0')}`;
    return { id: p.id, amount: p.amount, paidAt: p.paidAt, naturalMonth };
  });
  const { perMonth } = matchPayments(slots, paymentRefs);

  // monthsPerKind collects per-month data keyed by kind — over union span
  const monthsPerKind: Record<Kind, ItemBreakdown['months']> = {
    rent: [], services: [], electricity: [], gas: [], internet: [], water: [], other: [],
  };

  for (const slot of slots) {
    const match = perMonth[slot.month]!;
    const received = match.receivedTotal;
    const exp = slot.expected;
    const rentEffective = Math.max(0, exp.baseRent - slot.rentReduction);
    const effectiveExp = { ...exp, baseRent: rentEffective };
    const a = allocate(received, effectiveExp);

    const expectedTotal = exp.baseRent + exp.serviceAdvance + UTILITY_ORDER.reduce((s, k) => s + exp.utilities[k], 0);

    monthsPerKind.rent.push({
      month: slot.month, daysActive: exp.daysActive, daysInMonth: exp.daysInMonth,
      expectedThisKind: rentEffective, expectedTotal, receivedTotal: received, paidThisKind: a.baseRentPaid,
    });
    monthsPerKind.services.push({
      month: slot.month, daysActive: exp.daysActive, daysInMonth: exp.daysInMonth,
      expectedThisKind: exp.serviceAdvance, expectedTotal, receivedTotal: received, paidThisKind: a.servicePaid,
    });
    for (const kind of UTILITY_ORDER) {
      monthsPerKind[kind].push({
        month: slot.month, daysActive: exp.daysActive, daysInMonth: exp.daysInMonth,
        expectedThisKind: exp.utilities[kind], expectedTotal, receivedTotal: received, paidThisKind: a.utilityPaid[kind],
      });
    }
  }

  // Group cost statements by kind — only include statements whose periodFrom starts within recon period
  const statementsPerKind: Record<Kind, ItemBreakdown['costStatements']> = {
    rent: [], services: [], electricity: [], gas: [], internet: [], water: [], other: [],
  };
  // rent has no cost statement — actualCost = sum of effective rent across rent's matchPeriod months
  // (filled at result-build time below). Other kinds default to 0 and accumulate from statements.
  const costPerKind: Record<Kind, number> = {
    rent: 0,
    services: 0, electricity: 0, gas: 0, internet: 0, water: 0, other: 0,
  };

  // (kindsToShow + matchPeriodsPerKind already computed above)

  // For cost aggregation: use statements that "qualify" for each kind
  // (cs.periodFrom within recon period — same filter used by deriveMatchPeriod)
  for (const s of statements) {
    const k = s.kind as Kind;
    // A statement is included if its periodFrom starts within the recon period
    if (s.periodFrom >= periodFrom && s.periodFrom <= periodTo) {
      statementsPerKind[k].push({
        id: s.id, periodFrom: s.periodFrom, periodTo: s.periodTo,
        totalAmount: s.totalAmount, adjustmentAmount: s.adjustmentAmount,
        adjustmentNote: s.adjustmentNote, note: s.note, documentRef: s.documentRef,
      });
      costPerKind[k] += s.totalAmount + s.adjustmentAmount;
    }
  }

  // Build result items
  const result: Array<{ kind: Kind; actualCost: number; paid: number; difference: number; breakdown: ItemBreakdown }> = [];
  for (const kind of kindsToShow) {
    const mp = matchPeriodsPerKind.get(kind)!;
    const matchPeriodIsDifferentFromDefault = mp.source === 'from-cost-statements'
      && (mp.from !== periodFrom || mp.to !== periodTo);

    // Filter union months to this kind's matchPeriod
    const allMonths = monthsPerKind[kind];
    const mpFromMonth = mp.from.slice(0, 7);
    const mpToMonth = mp.to.slice(0, 7);
    const matchedMonths = allMonths.filter(m => m.month >= mpFromMonth && m.month <= mpToMonth);

    const paid = matchedMonths.reduce((s, m) => s + m.paidThisKind, 0);
    // For rent: actualCost = sum of effective expected rent across matched months (no cost statement)
    const actual = kind === 'rent'
      ? matchedMonths.reduce((s, m) => s + m.expectedThisKind, 0)
      : costPerKind[kind];
    if (actual === 0 && paid === 0) continue;

    result.push({
      kind,
      actualCost: actual,
      paid,
      difference: paid - actual,
      breakdown: {
        costStatements: statementsPerKind[kind],
        months: matchedMonths,  // breakdown panel zobrazí jen měsíce v matchPeriod
        matchPeriod: { from: mp.from, to: mp.to },
        matchPeriodSource: mp.source,
        matchPeriodIsDifferentFromDefault,
        ...(mp.shiftedFromNatural ? { matchPeriodNaturalFrom: mp.shiftedFromNatural } : {}),
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
  contractRow: { id: string; orgId: string; propertyId: string; startDate: string; endDate: string | null },
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

  // Compute union span across all matchPeriods (mirror deriveMatchPeriod logic) so payments
  // are loaded wide enough to cover all kinds. A statement qualifies if its periodFrom
  // is within the recon period.
  const qualifyingStatements = statements.filter(
    s => s.periodFrom >= periodFrom && s.periodFrom <= periodTo
  );
  const unionFrom = qualifyingStatements.length > 0
    ? qualifyingStatements.reduce((min, s) => s.periodFrom < min ? s.periodFrom : min, periodFrom)
    : periodFrom;
  const unionTo = qualifyingStatements.length > 0
    ? qualifyingStatements.reduce((max, s) => s.periodTo > max ? s.periodTo : max, periodTo)
    : periodTo;

  // For terms with paymentAppliesTo='next' shift the lower bound back by 1 month so
  // a Dec payment (naturalMonth = next Jan) is loaded for Jan slot matching.
  // Because terms are temporal, check if ANY terms valid within the union span uses 'next';
  // if so, shift. (Worst case adds 1 month — acceptable.)
  const anyNextInSpan = terms.some(t => t.paymentAppliesTo === 'next'
    && (t.validTo === null || t.validTo >= unionFrom)
    && t.validFrom <= unionTo);
  const offsetMonths = anyNextInSpan ? 1 : 0;
  const [pfY, pfM, pfD] = unionFrom.split('-').map(Number) as [number, number, number];
  let qfY = pfY;
  let qfM = pfM - offsetMonths;
  while (qfM < 1) { qfY -= 1; qfM += 12; }
  const paymentQueryFrom = `${qfY}-${String(qfM).padStart(2, '0')}-${String(pfD).padStart(2, '0')}`;

  const payments = await db.select().from(payment).where(
    and(eq(payment.contractId, contractRow.id), gte(payment.paidAt, paymentQueryFrom), lte(payment.paidAt, unionTo))
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
      breakdown: { costStatements: [], months: [], matchPeriod: { from: r.periodFrom, to: r.periodTo }, matchPeriodSource: 'default' as const, matchPeriodIsDifferentFromDefault: false },
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
      breakdown: live?.breakdown ?? { costStatements: [], months: [], matchPeriod: { from: row.periodFrom, to: row.periodTo }, matchPeriodSource: 'default' as const, matchPeriodIsDifferentFromDefault: false },
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
