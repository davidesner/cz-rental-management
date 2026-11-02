import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { daysSince, fmtKc, fmtKcExact, todayIso } from '@/lib/format';
import { dueLabel, reconciliationDeadline, type AgendaItem } from './useReminders';
import { breakdownRange, isActiveContract, useContracts, type ContractListRow } from './useContracts';

// The month rows of /api/contracts/:id/payment-breakdown, as the detail page
// reads them. Only the fields the dashboard sums are typed here.
interface MonthBreakdown {
  month: string;
  daysActive: number;
  expected: { baseRent: number; serviceAdvance: number; utilities: Record<string, number>; total: number };
  rentReduction: number;
  effectiveExpected: number;
  receivedTotal: number;
  allocation: { baseRentPaid: number; servicePaid: number; utilityPaid: Record<string, number>; surplus: number; deficitTotal: number };
  dueDate: string;
  isLate: boolean;
  maxLateDays: number;
}

interface PaymentBreakdownData { months: MonthBreakdown[] }

export interface Period { year: number; month: number | null }

export interface IncomeSummary {
  /** Allocated to rent and advances in the period (surplus not counted). */
  paid: number;
  paidAdvances: number;
  /** Unpaid with a due date already passed. */
  overdue: number;
  overdueAdvances: number;
  /** Unpaid with a due date still ahead. */
  upcoming: number;
  upcomingAdvances: number;
  expected: number;
  /** Rent alone as prescribed (after reductions), without advances. */
  rent: number;
  /** The months (YYYY-MM) that came due and were summed here. */
  months: string[];
}

export interface DebtRow {
  contractId: string;
  tenantName: string;
  propertyName: string;
  debt: number;
  /** Days since the oldest unpaid due date. */
  lateDays: number;
}

export interface Portfolio {
  properties: number;
  occupied: number;
  monthlyExpected: number;
  deposits: number;
}

function monthKeys(p: Period): (m: string) => boolean {
  if (p.month === null) return (m) => m.startsWith(`${p.year}-`);
  const key = `${p.year}-${String(p.month).padStart(2, '0')}`;
  return (m) => m === key;
}

function advancesPaid(m: MonthBreakdown): number {
  return m.allocation.servicePaid + Object.values(m.allocation.utilityPaid).reduce((s, v) => s + v, 0);
}

/** The part of a month's deficit that falls on advances: rent is covered first, so advances carry the rest. */
function advancesDeficit(m: MonthBreakdown): number {
  const rentDue = Math.max(0, m.expected.baseRent - m.rentReduction);
  const rentDeficit = Math.max(0, rentDue - m.allocation.baseRentPaid);
  return Math.max(0, m.allocation.deficitTotal - rentDeficit);
}

/**
 * Everything the dashboard shows, computed on the client from the contract
 * list and one payment-breakdown per running contract. There is no aggregate
 * endpoint; the numbers here follow the same rent-first allocation the detail
 * page displays, so they agree with it month by month.
 */
export function useDashboard(period: Period, filter: { propertyId?: string } = {}) {
  const today = todayIso();
  const contracts = useContracts();
  const properties = useQuery({ queryKey: ['properties'], queryFn: () => api.get<{ properties: Array<{ id: string }> }>('/api/properties') });
  // Unassigned bank payments belong to no property, so a property-scoped view skips them.
  const unassigned = useQuery({
    enabled: !filter.propertyId,
    queryKey: ['payments', 'unassigned-list'],
    queryFn: () => api.get<{ payments: Array<{ id: string; paidAt: string; amount: number; vs: string | null; counterparty: string | null }> }>('/api/payments?unassigned=true'),
  });
  const reconciliations = useQuery({
    queryKey: ['reconciliations', 'all'],
    queryFn: () => api.get<{ reconciliations: Array<{ id: string; contractId: string; periodFrom: string; periodTo: string; status: string }> }>('/api/reconciliations'),
  });

  const all = (contracts.data?.contracts ?? []).filter(c => !filter.propertyId || c.propertyId === filter.propertyId);
  // Contracts that overlap the period or run today: ended ones still owe or
  // earned money inside the chosen period.
  const relevant = all.filter(c => c.startDate <= today);

  const breakdowns = useQueries({
    queries: relevant.map(c => {
      const { from, to } = breakdownRange(c, today);
      return {
        queryKey: ['payment-breakdown', c.id, from, to],
        queryFn: () => api.get<PaymentBreakdownData>(`/api/contracts/${c.id}/payment-breakdown?from=${from}&to=${to}`),
      };
    }),
  });

  const isPending = contracts.isPending || properties.isPending || breakdowns.some(q => q.isPending);
  const isError = contracts.isError || properties.isError || breakdowns.some(q => q.isError);

  const inPeriod = monthKeys(period);
  const currentMonth = today.slice(0, 7);
  const agenda: AgendaItem[] = [];
  const income: IncomeSummary = { paid: 0, paidAdvances: 0, overdue: 0, overdueAdvances: 0, upcoming: 0, upcomingAdvances: 0, expected: 0, rent: 0, months: [] };
  /** The same summary per calendar year, every year with a month that came due, regardless of `period`. */
  const byYear: Record<string, IncomeSummary> = {};
  const debts: DebtRow[] = [];
  let monthlyExpected = 0;
  const occupiedProps = new Set<string>();
  let deposits = 0;

  relevant.forEach((c: ContractListRow, i) => {
    // Months that have come due: the current month and earlier, plus a later
    // month whose due date already passed (rent paid in advance).
    const months = (breakdowns[i]?.data?.months ?? []).filter(m => m.month <= currentMonth || m.dueDate <= today);
    for (const m of months) {
      const year = m.month.slice(0, 4);
      const yearly = byYear[year] ?? (byYear[year] = { paid: 0, paidAdvances: 0, overdue: 0, overdueAdvances: 0, upcoming: 0, upcomingAdvances: 0, expected: 0, rent: 0, months: [] });
      const targets = inPeriod(m.month) ? [income, yearly] : [yearly];
      const paid = m.receivedTotal - m.allocation.surplus;
      const adv = m.allocation.deficitTotal > 0 ? advancesDeficit(m) : 0;
      for (const t of targets) {
        t.paid += paid;
        t.paidAdvances += advancesPaid(m);
        t.expected += m.effectiveExpected;
        t.rent += Math.max(0, m.expected.baseRent - m.rentReduction);
        t.months.push(m.month);
        if (m.allocation.deficitTotal > 0) {
          if (m.dueDate < today) { t.overdue += m.allocation.deficitTotal; t.overdueAdvances += adv; }
          else { t.upcoming += m.allocation.deficitTotal; t.upcomingAdvances += adv; }
        }
      }
    }
    // Debt is period-independent: everything overdue up to today.
    const overdueMonths = months.filter(m => m.allocation.deficitTotal > 0 && m.dueDate < today);
    const debt = overdueMonths.reduce((s, m) => s + m.allocation.deficitTotal, 0);
    if (debt > 0) {
      const oldest = overdueMonths.reduce((min, m) => (m.dueDate < min ? m.dueDate : min), overdueMonths[0]!.dueDate);
      debts.push({ contractId: c.id, tenantName: c.tenantName, propertyName: c.propertyName, debt, lateDays: daysSince(oldest) });
    }
    if (isActiveContract(c, today)) {
      occupiedProps.add(c.propertyId);
      deposits += c.securityDeposit ?? 0;
      const latest = months[months.length - 1];
      if (latest) monthlyExpected += latest.expected.total;
      // Next rent due within a month, if it is not paid yet.
      const allMonths = breakdowns[i]?.data?.months ?? [];
      const next = allMonths.find(m => m.dueDate >= today && m.allocation.deficitTotal > 0);
      if (next && daysSince(next.dueDate) >= -31) {
        agenda.push({ key: `due:${c.id}`, date: next.dueDate, title: 'Splatnost nájmu', ref: `${c.propertyName}, ${fmtKc(next.allocation.deficitTotal)}`, href: `/contracts/${c.id}?tab=platby`, reminderId: null, done: false, ...dueLabel(next.dueDate, today) });
      }
      if (c.endDate && daysSince(c.endDate) >= -90) {
        agenda.push({ key: `end:${c.id}`, date: c.endDate, title: 'Končí nájemní smlouva', ref: `${c.propertyName}, ${c.tenantName}`, href: `/contracts/${c.id}`, reminderId: null, done: false, ...dueLabel(c.endDate, today) });
      }
    }
  });
  debts.sort((a, b) => b.debt - a.debt);

  for (const p of unassigned.data?.payments ?? []) {
    const waiting = daysSince(p.paidAt);
    agenda.push({ key: `pay:${p.id}`, date: p.paidAt, title: 'Přiřadit platbu z banky', ref: [fmtKcExact(p.amount), p.vs ? `VS ${p.vs}` : p.counterparty].filter(Boolean).join(', '), href: '/payments?filter=unassigned', reminderId: null, done: false, left: waiting <= 0 ? 'dnes' : `čeká ${waiting} ${waiting === 1 ? 'den' : waiting <= 4 ? 'dny' : 'dní'}`, tone: waiting > 7 ? 'over' : 'soon' });
  }
  // A draft reconciliation is work in progress; the deadline for handing the
  // annual statement to the tenant is four months after the period ends.
  for (const r of reconciliations.data?.reconciliations ?? []) {
    if (r.status !== 'draft') continue;
    const c = all.find(x => x.id === r.contractId);
    if (filter.propertyId && !c) continue;
    const deadline = reconciliationDeadline(r.periodTo);
    const year = r.periodFrom.slice(0, 4);
    const label = r.periodFrom === `${year}-01-01` && r.periodTo === `${year}-12-31` ? `za rok ${year}` : `${r.periodFrom} až ${r.periodTo}`;
    agenda.push({ key: `rec:${r.id}`, date: deadline, title: `Dokončit vyúčtování ${label}`, ref: c ? `${c.propertyName}, ${c.tenantName}` : '', href: `/reconciliations/${r.id}`, reminderId: null, done: false, ...dueLabel(deadline, today) });
  }
  agenda.sort((a, b) => a.date.localeCompare(b.date));

  const portfolio: Portfolio = {
    properties: properties.data?.properties.length ?? 0,
    occupied: occupiedProps.size,
    monthlyExpected,
    deposits,
  };

  return { isPending, isError, income, byYear, debts, portfolio, agenda, activeContracts: all.filter(c => isActiveContract(c, today)).length, refetch: () => { contracts.refetch(); properties.refetch(); unassigned.refetch(); reconciliations.refetch(); breakdowns.forEach(q => q.refetch()); } };
}
