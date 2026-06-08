import type { MonthExpectation } from './allocation.js';

export interface MonthSlot {
  month: string;            // YYYY-MM
  expected: MonthExpectation;
  effectiveExpected: number; // expected.total - rentReduction
  rentReduction: number;
  dueDate: string;          // YYYY-MM-DD
}

export interface PaymentRef {
  id: string;
  amount: number;
  paidAt: string;       // YYYY-MM-DD
  naturalMonth?: string; // YYYY-MM — month this payment is naturally for, derived from paidAt + contract.paymentAppliesTo. Caller precomputes.
}

export interface AppliedPayment {
  paymentId: string;
  paidAt: string;
  amount: number;
  lateDays: number; // days after dueDate; 0 if on time or early
}

export interface MonthMatch {
  month: string;
  appliedPayments: AppliedPayment[];
  receivedTotal: number;
  surplus: number; // amount applied beyond effectiveExpected (relevant for overpayments in the last month)
}

/**
 * Match each payment to ONE month (no splitting across months).
 *
 * Rule per payment (chronological):
 *   1. If the payment has a `naturalMonth` (calendar month derived from paidAt + contract
 *      paymentAppliesTo), check whether any EARLIER month is entirely unpaid (zero applied
 *      payments). If so, the payment is treated as a catch-up and lands on that earliest
 *      truly-skipped month. Otherwise it lands on its natural month.
 *   2. Without `naturalMonth`, fall back to "earliest month with remaining" (legacy FIFO).
 *   3. If no target slot found, the payment becomes periodSurplus.
 *
 * One payment is NEVER split across multiple months. Any overpayment stays as that
 * month's surplus.
 *
 * Small deficits (e.g. tenant paid 2 Kč less) do not pull a later payment in — the
 * later payment goes to its natural month and the deficit remains on the earlier one.
 * Only completely skipped months (zero applied payments) catch up via FIFO.
 */
export function matchPayments(
  slots: MonthSlot[],
  payments: PaymentRef[],
): { perMonth: Record<string, MonthMatch>; periodSurplus: number } {
  const sortedPayments = [...payments].sort((a, b) => a.paidAt.localeCompare(b.paidAt));
  const sortedSlots = [...slots].sort((a, b) => a.month.localeCompare(b.month));

  const remaining: Record<string, number> = {};
  const perMonth: Record<string, MonthMatch> = {};
  for (const s of sortedSlots) {
    remaining[s.month] = s.effectiveExpected;
    perMonth[s.month] = { month: s.month, appliedPayments: [], receivedTotal: 0, surplus: 0 };
  }

  let periodSurplus = 0;
  for (const p of sortedPayments) {
    let target: MonthSlot | undefined;

    if (p.naturalMonth) {
      // Look for an earlier slot that's entirely untouched (genuine skip)
      const earlierSkipped = sortedSlots.find((s) =>
        s.month < p.naturalMonth!
        && perMonth[s.month]!.appliedPayments.length === 0
        && (remaining[s.month] ?? 0) > 0,
      );
      target = earlierSkipped ?? sortedSlots.find((s) => s.month === p.naturalMonth);
    }

    // Fallback for payments without naturalMonth, or natural out-of-range
    if (!target) {
      target = sortedSlots.find((s) => (remaining[s.month] ?? 0) > 0);
    }

    if (!target) {
      periodSurplus += p.amount;
      continue;
    }

    const dueMs = new Date(target.dueDate + 'T00:00:00Z').getTime();
    const paidMs = new Date(p.paidAt + 'T00:00:00Z').getTime();
    const lateDays = Math.max(0, Math.round((paidMs - dueMs) / 86400000));
    perMonth[target.month]!.appliedPayments.push({
      paymentId: p.id, paidAt: p.paidAt, amount: p.amount, lateDays,
    });
    perMonth[target.month]!.receivedTotal += p.amount;
    remaining[target.month] = (remaining[target.month] ?? 0) - p.amount;
  }

  // Compute per-month surplus (amount received beyond effectiveExpected)
  for (const slot of sortedSlots) {
    const m = perMonth[slot.month]!;
    m.surplus = Math.max(0, m.receivedTotal - slot.effectiveExpected);
  }

  return { perMonth, periodSurplus };
}

/**
 * Compute the due date for a given target month based on contract payment settings.
 *
 * 'current': rent for the month is due in that SAME month, on paymentDueDay.
 * 'next':    rent is paid in ADVANCE — the payment for a target month falls in the
 *            PRIOR month (e.g. September payment covers October rent).
 *            So dueDate is in the month BEFORE the target month.
 */
export function computeDueDate(
  monthYYYYMM: string,
  paymentDueDay: number,
  paymentAppliesTo: 'current' | 'next',
): string {
  const [yStr, mStr] = monthYYYYMM.split('-');
  let y = parseInt(yStr!, 10);
  let m = parseInt(mStr!, 10);
  if (paymentAppliesTo === 'next') {
    // Payment for this month was due in the prior month
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(paymentDueDay, dim);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
