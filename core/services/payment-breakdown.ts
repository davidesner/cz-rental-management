import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { contract, contractTerms, contractUtility, payment, rentReduction } from '../db/schema.js';
import { AppError } from '../errors.js';
import { expectedForMonth, allocate, UTILITY_ORDER, type UtilityKind } from '../lib/allocation.js';

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
  const payments = await db.select().from(payment).where(and(
    eq(payment.contractId, contractId),
    gte(payment.paidAt, periodFrom),
    lte(payment.paidAt, periodTo),
  ));
  const reductions = await db.select().from(rentReduction).where(eq(rentReduction.contractId, contractId));

  // Iterate months from periodFrom to periodTo
  const months: MonthBreakdown[] = [];
  const [y0, m0] = periodFrom.split('-').map(Number) as [number, number];
  const [y1, m1] = periodTo.split('-').map(Number) as [number, number];
  let y = y0, m = m0;
  while (y < y1 || (y === y1 && m <= m1)) {
    const monthFirst = `${y}-${String(m).padStart(2, '0')}-01`;
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthLast = `${y}-${String(m).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;
    const exp = expectedForMonth(
      y, m, c.startDate, c.endDate ?? null,
      terms.map(t => ({ validFrom: t.validFrom, validTo: t.validTo, baseRent: t.baseRent, serviceAdvance: t.serviceAdvance })),
      utilities.map(u => ({ kind: u.kind as UtilityKind, validFrom: u.validFrom, validTo: u.validTo, monthlyAdvance: u.monthlyAdvance })),
    );
    const periodPayments = payments.filter(p => p.paidAt >= monthFirst && p.paidAt <= monthLast);
    const received = periodPayments.reduce((s, p) => s + p.amount, 0);
    const alloc = allocate(received, exp);
    const reduction = reductions.find(r => r.forMonth === monthFirst);
    const expectedTotal = exp.baseRent + exp.serviceAdvance + Object.values(exp.utilities).reduce((s, v) => s + v, 0);
    const deficitTotal = alloc.deficit.baseRent + alloc.deficit.serviceAdvance + Object.values(alloc.deficit.utilities).reduce((s, v) => s + v, 0);
    months.push({
      month: `${y}-${String(m).padStart(2, '0')}`,
      daysActive: exp.daysActive, daysInMonth: exp.daysInMonth,
      expected: { baseRent: exp.baseRent, serviceAdvance: exp.serviceAdvance, utilities: exp.utilities, total: expectedTotal },
      rentReduction: reduction?.amount ?? 0,
      effectiveExpected: expectedTotal - (reduction?.amount ?? 0),
      receivedTotal: received,
      allocation: {
        baseRentPaid: alloc.baseRentPaid, servicePaid: alloc.servicePaid,
        utilityPaid: alloc.utilityPaid, surplus: alloc.surplus, deficitTotal,
      },
      paymentIds: periodPayments.map(p => p.id),
    });
    m++; if (m > 12) { y++; m = 1; }
  }

  return {
    months,
    rentReductions: reductions.map(r => ({ id: r.id, forMonth: r.forMonth, amount: r.amount, reason: r.reason })),
  };
}
