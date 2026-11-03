import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { todayIso } from '@/lib/format';

export interface ContractListRow {
  id: string;
  propertyId: string;
  tenantId: string;
  propertyName: string;
  tenantName: string;
  startDate: string;
  /** Original end of the fixed term; null = open-ended. */
  endDate: string | null;
  autoRenew: boolean;
  renewalMonths: number | null;
  /** End of the renewal period running today, or `endDate` when nothing renews. */
  effectiveEndDate: string | null;
  securityDeposit: number | null;
  note?: string | null;
}

export interface LeaseEnd { endDate: string | null; effectiveEndDate?: string | null }

/** The end that matters for "is it running": the renewed one when there is one. */
export function leaseEnd(c: LeaseEnd): string | null {
  return c.effectiveEndDate === undefined ? c.endDate : c.effectiveEndDate;
}

export interface ContractTermRow {
  id: string;
  validFrom: string;
  validTo?: string | null;
  baseRent: number;
  serviceAdvance: number;
  paymentDueDay: number;
  paymentAppliesTo: 'current' | 'next';
  source: string;
  documentRef: string | null;
  note: string | null;
}

export interface ContractUtilityRow {
  id: string;
  kind: string;
  validFrom: string;
  validTo?: string | null;
  monthlyAdvance: number;
  note: string | null;
}

export function useContracts() {
  return useQuery({ queryKey: ['contracts'], queryFn: () => api.get<{ contracts: ContractListRow[] }>('/api/contracts') });
}

/** The row in force on `date` under the SCD2 rule: validFrom <= date < validTo (null = open). */
export function validOn<T extends { validFrom: string; validTo?: string | null }>(rows: T[], date: string): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.validFrom <= date && (r.validTo === null || r.validTo === undefined || date < r.validTo)) {
      if (best === null || r.validFrom >= best.validFrom) best = r;
    }
  }
  return best;
}

/**
 * The period the payment breakdown is asked for. The upper bound never ends
 * before today: the API drops payments after it, and a tenant who settles
 * arrears after moving out would otherwise stay in debt forever.
 */
export function breakdownRange(c: { startDate: string } & LeaseEnd, today = todayIso()): { from: string; to: string } {
  const end = leaseEnd(c) ?? today;
  return { from: c.startDate, to: end > today ? end : today };
}

/** Running today: started, and either open-ended or not yet ended. */
export function isActiveContract(c: { startDate: string } & LeaseEnd, today = todayIso()): boolean {
  const end = leaseEnd(c);
  return c.startDate <= today && (end === null || end >= today);
}

/** Over: the end date has passed. A lease that has not started yet is not ended. */
export function isEndedContract(c: LeaseEnd, today = todayIso()): boolean {
  const end = leaseEnd(c);
  return end !== null && end < today;
}

export interface CurrentTerms {
  term: ContractTermRow | null;
  utilities: ContractUtilityRow[];
  /** Rent + SVJ advance + every utility advance, or null without terms. */
  monthlyTotal: number | null;
}

/**
 * The terms and utilities in force today for each contract, keyed by id. A
 * future-dated amendment leaves its own row open, so "open row" is not the
 * same as "effective now".
 *
 * The list endpoint returns contracts without their terms, so this is one
 * request per contract for terms and one for utilities; both are cached under
 * the same keys the detail page uses, so navigating there is free.
 */
export function useCurrentTermsMap(contractIds: string[]): { map: Record<string, CurrentTerms>; isPending: boolean } {
  const termQueries = useQueries({
    queries: contractIds.map(id => ({
      queryKey: ['contracts', id, 'terms'],
      queryFn: () => api.get<{ terms: ContractTermRow[] }>(`/api/contracts/${id}/terms`),
    })),
  });
  const utilQueries = useQueries({
    queries: contractIds.map(id => ({
      queryKey: ['contracts', id, 'utilities'],
      queryFn: () => api.get<{ utilities: ContractUtilityRow[] }>(`/api/contracts/${id}/utilities`),
    })),
  });
  const map: Record<string, CurrentTerms> = {};
  const today = todayIso();
  contractIds.forEach((id, i) => {
    const terms = termQueries[i]?.data?.terms;
    const utils = utilQueries[i]?.data?.utilities;
    if (!terms || !utils) return;
    const term = validOn(terms, today);
    const kinds = Array.from(new Set(utils.map(u => u.kind)));
    const utilities = kinds.map(k => validOn(utils.filter(u => u.kind === k), today)).filter((u): u is ContractUtilityRow => u !== null);
    const monthlyTotal = term ? term.baseRent + term.serviceAdvance + utilities.reduce((s, u) => s + u.monthlyAdvance, 0) : null;
    map[id] = { term, utilities, monthlyTotal };
  });
  const isPending = termQueries.some(q => q.isPending) || utilQueries.some(q => q.isPending);
  return { map, isPending };
}
