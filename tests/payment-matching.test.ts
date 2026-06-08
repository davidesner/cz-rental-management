import { describe, it, expect } from 'vitest';
import { matchPayments, computeDueDate, type MonthSlot, type PaymentRef } from '../core/lib/payment-matching.js';

// Helper: build a minimal MonthSlot
function slot(month: string, effectiveExpected: number, dueDate?: string): MonthSlot {
  return {
    month,
    expected: { baseRent: effectiveExpected, serviceAdvance: 0, utilities: { electricity: 0, gas: 0, internet: 0, water: 0, other: 0 }, daysActive: 30, daysInMonth: 30 },
    effectiveExpected,
    rentReduction: 0,
    dueDate: dueDate ?? `${month}-10`,
  };
}

function payment(id: string, amount: number, paidAt: string): PaymentRef {
  return { id, amount, paidAt };
}

// ─── matchPayments ────────────────────────────────────────────────────────────

describe('matchPayments', () => {
  it('single payment fits exact expected → fully applied to that month, no surplus', () => {
    const slots = [slot('2024-10', 100000, '2024-10-10')];
    const payments = [payment('p1', 100000, '2024-10-08')];
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    expect(perMonth['2024-10']!.receivedTotal).toBe(100000);
    expect(perMonth['2024-10']!.appliedPayments).toHaveLength(1);
    expect(perMonth['2024-10']!.appliedPayments[0]!.amount).toBe(100000);
    expect(perMonth['2024-10']!.appliedPayments[0]!.lateDays).toBe(0); // paid before due date
    expect(periodSurplus).toBe(0);
  });

  it('single payment exceeds expected → stays as surplus on its target month (no spill)', () => {
    const slots = [
      slot('2024-10', 100000, '2024-10-10'),
      slot('2024-11', 100000, '2024-11-10'),
    ];
    const payments = [payment('p1', 150000, '2024-10-08')];
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    // Whole payment lands on October — overpayment is surplus on Oct, NOT contributing to Nov
    expect(perMonth['2024-10']!.receivedTotal).toBe(150000);
    expect(perMonth['2024-10']!.surplus).toBe(50000);
    expect(perMonth['2024-11']!.receivedTotal).toBe(0);
    expect(periodSurplus).toBe(0);
  });

  it('single payment exceeds the only month → entire amount lands there, surplus visible', () => {
    const slots = [slot('2024-10', 100000, '2024-10-10')];
    const payments = [payment('p1', 250000, '2024-10-08')];
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    expect(perMonth['2024-10']!.receivedTotal).toBe(250000);
    expect(perMonth['2024-10']!.surplus).toBe(150000);
    // No spill, so periodSurplus is 0 (the amount IS in October's surplus)
    expect(periodSurplus).toBe(0);
  });

  it('payment when every month already fully paid → periodSurplus catches it', () => {
    const slots = [slot('2024-10', 100000, '2024-10-10')];
    const payments = [
      payment('p1', 100000, '2024-10-05'), // covers October exactly
      payment('p2', 50000, '2024-10-20'),  // no remaining month → periodSurplus
    ];
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    expect(perMonth['2024-10']!.receivedTotal).toBe(100000);
    expect(periodSurplus).toBe(50000);
  });

  it('late payment after due date → lateDays calculated correctly', () => {
    const slots = [slot('2024-10', 100000, '2024-10-10')];
    const payments = [payment('p1', 100000, '2024-10-20')]; // 10 days late
    const { perMonth } = matchPayments(slots, payments);

    const ap = perMonth['2024-10']!.appliedPayments[0]!;
    expect(ap.lateDays).toBe(10);
  });

  it('payment on due date → 0 lateDays', () => {
    const slots = [slot('2024-10', 100000, '2024-10-10')];
    const payments = [payment('p1', 100000, '2024-10-10')];
    const { perMonth } = matchPayments(slots, payments);

    expect(perMonth['2024-10']!.appliedPayments[0]!.lateDays).toBe(0);
  });

  it('multiple payments: one early one late → FIFO ordering preserved, both applied to same month', () => {
    const slots = [slot('2024-10', 200000, '2024-10-10')];
    const payments = [
      payment('p-late', 100000, '2024-10-25'), // late
      payment('p-early', 100000, '2024-10-05'), // early
    ];
    const { perMonth } = matchPayments(slots, payments);

    // Sorted by paidAt: p-early first, then p-late
    const applied = perMonth['2024-10']!.appliedPayments;
    expect(applied).toHaveLength(2);
    expect(applied[0]!.paymentId).toBe('p-early');
    expect(applied[0]!.lateDays).toBe(0);
    expect(applied[1]!.paymentId).toBe('p-late');
    expect(applied[1]!.lateDays).toBe(15);
    expect(perMonth['2024-10']!.receivedTotal).toBe(200000);
  });

  it('no payments → all months have receivedTotal 0 and empty appliedPayments', () => {
    const slots = [
      slot('2024-10', 100000, '2024-10-10'),
      slot('2024-11', 100000, '2024-11-10'),
    ];
    const { perMonth, periodSurplus } = matchPayments(slots, []);

    expect(perMonth['2024-10']!.receivedTotal).toBe(0);
    expect(perMonth['2024-11']!.receivedTotal).toBe(0);
    expect(perMonth['2024-10']!.appliedPayments).toHaveLength(0);
    expect(periodSurplus).toBe(0);
  });

  it('FIFO: late payment lands on the earliest unpaid month (whole amount, no split)', () => {
    // October was not paid; November payment lands entirely on October (the earliest unpaid)
    const slots = [
      slot('2024-10', 100000, '2024-10-10'),
      slot('2024-11', 100000, '2024-11-10'),
    ];
    const payments = [
      payment('p1', 200000, '2024-11-08'), // entire 200000 goes to October (earliest unpaid)
    ];
    const { perMonth } = matchPayments(slots, payments);

    expect(perMonth['2024-10']!.receivedTotal).toBe(200000);
    expect(perMonth['2024-10']!.surplus).toBe(100000);
    expect(perMonth['2024-11']!.receivedTotal).toBe(0);
    // October is filled by a payment dated 2024-11-08, which is 29 days late (due 2024-10-10)
    const octAp = perMonth['2024-10']!.appliedPayments[0]!;
    expect(octAp.paymentId).toBe('p1');
    expect(octAp.lateDays).toBeGreaterThan(0);
  });

  it('slot with effectiveExpected 0 is skipped (e.g. prorated month with 0 active days)', () => {
    const slots = [
      { ...slot('2024-09', 0, '2024-09-10'), effectiveExpected: 0 },
      slot('2024-10', 100000, '2024-10-10'),
    ];
    const payments = [payment('p1', 100000, '2024-09-15')];
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    expect(perMonth['2024-09']!.receivedTotal).toBe(0);
    expect(perMonth['2024-10']!.receivedTotal).toBe(100000);
    expect(periodSurplus).toBe(0);
  });
});

// ─── computeDueDate ───────────────────────────────────────────────────────────

describe('computeDueDate', () => {
  it('current mode: due is in the same month on the given day', () => {
    expect(computeDueDate('2024-10', 10, 'current')).toBe('2024-10-10');
    expect(computeDueDate('2024-02', 28, 'current')).toBe('2024-02-28');
    expect(computeDueDate('2025-02', 31, 'current')).toBe('2025-02-28'); // clamp to end of month
  });

  it('next mode: due is in the PRIOR month (advance payment)', () => {
    // Payment for October is due in September
    expect(computeDueDate('2024-10', 10, 'next')).toBe('2024-09-10');
    // Payment for January is due in December of the prior year
    expect(computeDueDate('2024-01', 10, 'next')).toBe('2023-12-10');
  });

  it('next mode: clamps day to end of prior month', () => {
    // Payment for March (31-day) due in February (28 or 29 days)
    expect(computeDueDate('2024-03', 31, 'next')).toBe('2024-02-29'); // 2024 is leap year
    expect(computeDueDate('2025-03', 31, 'next')).toBe('2025-02-28'); // 2025 is not leap year
  });

  it('current mode: day 1 is valid', () => {
    expect(computeDueDate('2024-06', 1, 'current')).toBe('2024-06-01');
  });
});
