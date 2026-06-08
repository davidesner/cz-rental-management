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
  paidAt: string; // YYYY-MM-DD
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
 * Rule: for each payment (chronological), pick the earliest month with remaining
 * expected balance and apply the FULL payment amount there. If the payment exceeds
 * that month's expected, the excess becomes surplus on that month (not redistributed).
 * If all months in the period are already fully paid, the payment becomes periodSurplus.
 *
 * This matches typical landlord intuition: one bank transfer = one rent payment for
 * one month. Overpayments (e.g. tenant rounds up) stay as month-level surplus, not
 * a contribution to next month's rent.
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
    // Find earliest month with remaining (unpaid) balance
    const target = sortedSlots.find((s) => (remaining[s.month] ?? 0) > 0);
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
    // Drive remaining negative if payment exceeds expected; later payments still find
    // the next month with remaining > 0 because this one's remaining is now <= 0.
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
