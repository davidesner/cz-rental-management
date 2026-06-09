import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { contract, contractTerms, contractUtility, payment, rentReduction } from '../db/schema.js';
import { AppError } from '../errors.js';
import { expectedForMonth, allocate, UTILITY_ORDER, type UtilityKind } from '../lib/allocation.js';
import { matchPayments, computeDueDate, type MonthSlot } from '../lib/payment-matching.js';

export interface AppliedPaymentBreakdown {
  paymentId: string;
  paidAt: string;
  amount: number;
  lateDays: number;
}

export interface MonthBreakdown {
  month: string;             // YYYY-MM
  daysActive: number;
  daysInMonth: number;
  expected: {
    baseRent: number;
    serviceAdvance: number;
    utilities: Record<UtilityKind, number>;
    total: number;
  };
  rentReduction: number;     // haléře, 0 if none
  effectiveExpected: number; // expected.total - rentReduction
  receivedTotal: number;
  allocation: {
    baseRentPaid: number;
    servicePaid: number;
    utilityPaid: Record<UtilityKind, number>;
    surplus: number;
    deficitTotal: number;
  };
  dueDate: string;           // YYYY-MM-DD
  appliedPayments: AppliedPaymentBreakdown[];
  isLate: boolean;           // any applied payment has lateDays > 0
  maxLateDays: number;       // max lateDays across applied payments
  /** @deprecated use appliedPayments */
  paymentIds: string[];
}

export async function paymentBreakdown(
  db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null,
  periodFrom: string, periodTo: string,
): Promise<{ months: MonthBreakdown[]; rentReductions: Array<{ id: string; forMonth: string; amount: number; reason: string | null }> }> {
  const [c] = await db.select().from(contract).where(and(eq(contract.id, contractId), eq(contract.orgId, orgId)));
  if (!c) throw new AppError('not_found', 'contract not in org');
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(c.propertyId)) {
    throw new AppError('forbidden', 'no access');
  }

  const terms = await db.select().from(contractTerms).where(eq(contractTerms.contractId, contractId)).orderBy(asc(contractTerms.validFrom));
  const utilities = await db.select().from(contractUtility).where(eq(contractUtility.contractId, contractId)).orderBy(asc(contractUtility.validFrom));

  const paymentDueDay = c.paymentDueDay;
  const paymentAppliesTo = c.paymentAppliesTo as 'current' | 'next';

  // For paymentAppliesTo='next' shift the lower bound back by 1 month so Dec payment
  // (whose naturalMonth = next Jan) is loaded for Jan slot matching.
  const offsetMonths = paymentAppliesTo === 'next' ? 1 : 0;
  const [pfY, pfM, pfD] = periodFrom.split('-').map(Number) as [number, number, number];
  let qfY = pfY;
  let qfM = pfM - offsetMonths;
  while (qfM < 1) { qfY -= 1; qfM += 12; }
  const paymentQueryFrom = `${qfY}-${String(qfM).padStart(2, '0')}-${String(pfD).padStart(2, '0')}`;

  const payments = await db.select().from(payment).where(and(
    eq(payment.contractId, contractId),
    gte(payment.paidAt, paymentQueryFrom),
    lte(payment.paidAt, periodTo),
  ));
  const reductions = await db.select().from(rentReduction).where(eq(rentReduction.contractId, contractId));

  // Build month slots
  const slots: MonthSlot[] = [];
  const [y0, m0] = periodFrom.split('-').map(Number) as [number, number];
  const [y1, m1] = periodTo.split('-').map(Number) as [number, number];
  let y = y0, m = m0;
  while (y < y1 || (y === y1 && m <= m1)) {
    const monthStr = `${y}-${String(m).padStart(2, '0')}`;
    const monthFirst = `${monthStr}-01`;
    const exp = expectedForMonth(
      y, m, c.startDate, c.endDate ?? null,
      terms.map(t => ({ validFrom: t.validFrom, validTo: t.validTo, baseRent: t.baseRent, serviceAdvance: t.serviceAdvance })),
      utilities.map(u => ({ kind: u.kind as UtilityKind, validFrom: u.validFrom, validTo: u.validTo, monthlyAdvance: u.monthlyAdvance })),
    );
    const reduction = reductions.find(r => r.forMonth === monthFirst);
    const expectedTotal = exp.baseRent + exp.serviceAdvance + Object.values(exp.utilities).reduce((s, v) => s + v, 0);
    const rentReductionAmt = reduction?.amount ?? 0;
    const dueDate = computeDueDate(monthStr, paymentDueDay, paymentAppliesTo);
    slots.push({
      month: monthStr,
      expected: exp,
      effectiveExpected: expectedTotal - rentReductionAmt,
      rentReduction: rentReductionAmt,
      dueDate,
    });
    m++; if (m > 12) { y++; m = 1; }
  }

  // FIFO matching — precompute naturalMonth per payment based on contract paymentAppliesTo
  const offset = paymentAppliesTo === 'next' ? 1 : 0;
  const paymentRefs = payments.map(p => {
    const [yy, mm] = p.paidAt.split('-').map(Number) as [number, number, number];
    let nm = mm + offset;
    let ny = yy;
    if (nm > 12) { nm = nm - 12; ny += 1; }
    const naturalMonth = `${ny}-${String(nm).padStart(2, '0')}`;
    return { id: p.id, amount: p.amount, paidAt: p.paidAt, naturalMonth };
  });
  const { perMonth } = matchPayments(slots, paymentRefs);

  // Build month breakdowns
  const months: MonthBreakdown[] = slots.map(slot => {
    const match = perMonth[slot.month]!;
    const received = match.receivedTotal;
    // Apply rentReduction (srážka) to baseRent for allocation purposes — tenant's effective
    // rent obligation that month is baseRent − srážka. Rent-first allocation fills this
    // reduced amount; the rest flows to services/utilities.
    const rentEffective = Math.max(0, slot.expected.baseRent - slot.rentReduction);
    const effectiveExp = { ...slot.expected, baseRent: rentEffective };
    const alloc = allocate(received, effectiveExp);
    const expectedTotal = slot.expected.baseRent + slot.expected.serviceAdvance + Object.values(slot.expected.utilities).reduce((s, v) => s + v, 0);
    const deficitTotal = alloc.deficit.baseRent + alloc.deficit.serviceAdvance + Object.values(alloc.deficit.utilities).reduce((s, v) => s + v, 0);
    const maxLateDays = match.appliedPayments.reduce((max, ap) => Math.max(max, ap.lateDays), 0);
    return {
      month: slot.month,
      daysActive: slot.expected.daysActive,
      daysInMonth: slot.expected.daysInMonth,
      expected: {
        baseRent: slot.expected.baseRent,
        serviceAdvance: slot.expected.serviceAdvance,
        utilities: slot.expected.utilities,
        total: expectedTotal,
      },
      rentReduction: slot.rentReduction,
      effectiveExpected: slot.effectiveExpected,
      receivedTotal: received,
      allocation: {
        baseRentPaid: alloc.baseRentPaid,
        servicePaid: alloc.servicePaid,
        utilityPaid: alloc.utilityPaid,
        surplus: alloc.surplus,
        deficitTotal,
      },
      dueDate: slot.dueDate,
      appliedPayments: match.appliedPayments,
      isLate: maxLateDays > 0,
      maxLateDays,
      paymentIds: match.appliedPayments.map(ap => ap.paymentId),
    };
  });

  return {
    months,
    rentReductions: reductions.map(r => ({ id: r.id, forMonth: r.forMonth, amount: r.amount, reason: r.reason })),
  };
}
