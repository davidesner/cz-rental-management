import { validAt } from './temporal.js';

export type UtilityKind = 'electricity' | 'gas' | 'internet' | 'water' | 'other';
export const UTILITY_ORDER: readonly UtilityKind[] = ['electricity', 'gas', 'internet', 'water', 'other'];

export interface TermsRow { validFrom: string; validTo: string | null; baseRent: number; serviceAdvance: number; }
export interface UtilityRow { kind: UtilityKind; validFrom: string; validTo: string | null; monthlyAdvance: number; }

export interface MonthExpectation {
  baseRent: number;
  serviceAdvance: number;
  utilities: Record<UtilityKind, number>; // 0 if not configured
  daysActive: number;
  daysInMonth: number;
}

export interface MonthAllocation {
  baseRentPaid: number;
  servicePaid: number;
  utilityPaid: Record<UtilityKind, number>;
  surplus: number;
  deficit: { baseRent: number; serviceAdvance: number; utilities: Record<UtilityKind, number> };
}

function daysInMonthFor(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Compute active-days overlap between the contract window and the calendar month.
 * Returns daysActive and daysInMonth.
 */
export function monthCoverage(year: number, month: number, contractStart: string, contractEnd: string | null): { daysActive: number; daysInMonth: number; firstActive: string; lastActive: string } {
  const dim = daysInMonthFor(year, month);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;
  const firstActive = contractStart > monthStart ? contractStart : monthStart;
  const effectiveEnd = contractEnd ?? '9999-12-31';
  const lastActive = effectiveEnd < monthEnd ? effectiveEnd : monthEnd;
  if (firstActive > lastActive) return { daysActive: 0, daysInMonth: dim, firstActive, lastActive };
  const start = new Date(firstActive + 'T00:00:00Z');
  const end = new Date(lastActive + 'T00:00:00Z');
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return { daysActive: days, daysInMonth: dim, firstActive, lastActive };
}

/**
 * Compute expected payment for a contract-month based on terms valid on a reference date
 * (midpoint of the active window) and utilities valid on same date. Prorates by daysActive/daysInMonth.
 */
export function expectedForMonth(
  year: number,
  month: number,
  contractStart: string,
  contractEnd: string | null,
  terms: TermsRow[],
  utilities: UtilityRow[],
): MonthExpectation {
  const cov = monthCoverage(year, month, contractStart, contractEnd);
  const emptyUtil: Record<UtilityKind, number> = { electricity: 0, gas: 0, internet: 0, water: 0, other: 0 };
  if (cov.daysActive === 0) {
    return { baseRent: 0, serviceAdvance: 0, utilities: emptyUtil, daysActive: 0, daysInMonth: cov.daysInMonth };
  }
  const refDate = cov.firstActive;
  const t = validAt(terms, refDate);
  const baseRent = t ? Math.round(t.baseRent * cov.daysActive / cov.daysInMonth) : 0;
  const serviceAdvance = t ? Math.round(t.serviceAdvance * cov.daysActive / cov.daysInMonth) : 0;
  const utilExpect: Record<UtilityKind, number> = { ...emptyUtil };
  for (const kind of UTILITY_ORDER) {
    const u = utilities.filter((x) => x.kind === kind);
    const active = validAt(u, refDate);
    if (active) utilExpect[kind] = Math.round(active.monthlyAdvance * cov.daysActive / cov.daysInMonth);
  }
  return { baseRent, serviceAdvance, utilities: utilExpect, daysActive: cov.daysActive, daysInMonth: cov.daysInMonth };
}

/**
 * Allocate `received` across expected components in utility-first order.
 */
export function allocate(received: number, expectation: MonthExpectation): MonthAllocation {
  let remaining = received;
  const utilityPaid: Record<UtilityKind, number> = { electricity: 0, gas: 0, internet: 0, water: 0, other: 0 };
  const utilityDeficit: Record<UtilityKind, number> = { electricity: 0, gas: 0, internet: 0, water: 0, other: 0 };

  for (const kind of UTILITY_ORDER) {
    const want = expectation.utilities[kind];
    if (want <= 0) continue;
    const give = Math.min(remaining, want);
    utilityPaid[kind] = give;
    if (give < want) utilityDeficit[kind] = want - give;
    remaining -= give;
  }
  const wantService = expectation.serviceAdvance;
  const giveService = Math.min(remaining, wantService);
  remaining -= giveService;
  const wantRent = expectation.baseRent;
  const giveRent = Math.min(remaining, wantRent);
  remaining -= giveRent;

  return {
    baseRentPaid: giveRent,
    servicePaid: giveService,
    utilityPaid,
    surplus: remaining,
    deficit: {
      baseRent: Math.max(0, wantRent - giveRent),
      serviceAdvance: Math.max(0, wantService - giveService),
      utilities: utilityDeficit,
    },
  };
}
