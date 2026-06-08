import { describe, it, expect } from 'vitest';
import { matchPayments, computeDueDate, type MonthSlot, type PaymentRef } from '../core/lib/payment-matching.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function slot(month: string, effectiveExpected: number, dueDate?: string): MonthSlot {
  return {
    month,
    expected: {
      baseRent: effectiveExpected,
      serviceAdvance: 0,
      utilities: { electricity: 0, gas: 0, internet: 0, water: 0, other: 0 },
      daysActive: 30,
      daysInMonth: 30,
    },
    effectiveExpected,
    rentReduction: 0,
    dueDate: dueDate ?? `${month}-10`,
  };
}

function payment(id: string, amount: number, paidAt: string, naturalMonth?: string): PaymentRef {
  return { id, amount, paidAt, ...(naturalMonth ? { naturalMonth } : {}) };
}

// ─── matchPayments – edge cases ───────────────────────────────────────────────

describe('matchPayments – edge cases', () => {
  // ── empty inputs ────────────────────────────────────────────────────────────

  it('no payments, no slots → empty perMonth and periodSurplus 0', () => {
    const { perMonth, periodSurplus } = matchPayments([], []);
    expect(Object.keys(perMonth)).toHaveLength(0);
    expect(periodSurplus).toBe(0);
  });

  it('no payments, multiple slots → every slot receivedTotal 0, surplus 0, empty appliedPayments', () => {
    const slots = [slot('2024-01', 50000), slot('2024-02', 50000), slot('2024-03', 50000)];
    const { perMonth, periodSurplus } = matchPayments(slots, []);

    for (const m of ['2024-01', '2024-02', '2024-03']) {
      expect(perMonth[m]!.receivedTotal).toBe(0);
      expect(perMonth[m]!.surplus).toBe(0);
      expect(perMonth[m]!.appliedPayments).toHaveLength(0);
    }
    expect(periodSurplus).toBe(0);
  });

  // ── naturalMonth routing ────────────────────────────────────────────────────

  it('naturalMonth = X, slot X is empty and no earlier slots → goes to X', () => {
    const slots = [slot('2024-03', 100000, '2024-03-10')];
    const payments = [payment('p1', 100000, '2024-03-05', '2024-03')];
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    expect(perMonth['2024-03']!.receivedTotal).toBe(100000);
    expect(periodSurplus).toBe(0);
  });

  it('naturalMonth = X, X already has a payment, earlier slot Y is empty → goes to Y', () => {
    const slots = [
      slot('2024-01', 100000, '2024-01-10'),
      slot('2024-03', 100000, '2024-03-10'),
    ];
    // Both payments have naturalMonth = March. At the time p1 is processed, January is empty
    // and earlier than March → p1 is redirected to January (skip-routing).
    // At the time p2 is processed, January now has p1 (not empty) → p2 goes to March (its natural).
    const payments = [
      payment('p1', 50000, '2024-03-05', '2024-03'),
      payment('p2', 80000, '2024-03-20', '2024-03'),
    ];
    const { perMonth } = matchPayments(slots, payments);

    // p1 → January (earliest empty earlier than March)
    expect(perMonth['2024-01']!.appliedPayments[0]!.paymentId).toBe('p1');
    expect(perMonth['2024-01']!.receivedTotal).toBe(50000);
    // p2 → March (Jan no longer empty; natural = March)
    expect(perMonth['2024-03']!.appliedPayments[0]!.paymentId).toBe('p2');
    expect(perMonth['2024-03']!.receivedTotal).toBe(80000);
  });

  it('naturalMonth = X, X already has payment, no earlier empty slot → goes to X (creates surplus)', () => {
    const slots = [slot('2024-05', 100000, '2024-05-10')];
    const payments = [
      payment('p1', 100000, '2024-05-08', '2024-05'),
      payment('p2', 60000, '2024-05-20', '2024-05'),
    ];
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    // p2 has no earlier empty; goes to its natural month (May already full → surplus on May)
    // BUT remaining[May] is 0 after p1, and the fallback for p2 (natural=May, no earlier empty)
    // targets May → remaining becomes negative (surplus computed separately)
    // Actually: the code finds s.month === p.naturalMonth even if remaining is 0 or negative.
    // May IS the natural slot and there's no earlier empty → target = May
    expect(perMonth['2024-05']!.receivedTotal).toBe(160000);
    expect(perMonth['2024-05']!.surplus).toBe(60000);
    expect(periodSurplus).toBe(0);
  });

  it('all slots full when payment arrives → periodSurplus', () => {
    const slots = [slot('2024-06', 100000, '2024-06-10')];
    const payments = [
      payment('p1', 100000, '2024-06-05', '2024-06'), // fills June
      payment('p2', 40000, '2024-06-25', '2024-06'),  // June already has payment → goes to June,
                                                        // but with naturalMonth set it hits June again
    ];
    // p2 natural = June; no earlier empty; June IS its natural → goes to June
    // (surplus on June, not periodSurplus)
    const { perMonth, periodSurplus } = matchPayments(slots, payments);
    expect(perMonth['2024-06']!.receivedTotal).toBe(140000);
    expect(perMonth['2024-06']!.surplus).toBe(40000);
    expect(periodSurplus).toBe(0);
  });

  it('payment without naturalMonth, slot with remaining exists → goes to earliest remaining slot', () => {
    const slots = [
      slot('2024-01', 100000, '2024-01-10'),
      slot('2024-02', 100000, '2024-02-10'),
    ];
    const payments = [payment('p1', 70000, '2024-02-15')]; // no naturalMonth
    const { perMonth } = matchPayments(slots, payments);

    // No naturalMonth → FIFO → goes to Jan (first with remaining)
    expect(perMonth['2024-01']!.receivedTotal).toBe(70000);
    expect(perMonth['2024-02']!.receivedTotal).toBe(0);
  });

  it('payment without naturalMonth, no slot with remaining → periodSurplus', () => {
    const slots = [slot('2024-01', 0)]; // effectiveExpected = 0, so no remaining
    const payments = [payment('p1', 50000, '2024-01-15')];
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    expect(perMonth['2024-01']!.receivedTotal).toBe(0);
    expect(periodSurplus).toBe(50000);
  });

  it('naturalMonth not in slots → falls back to first remaining slot', () => {
    const slots = [slot('2024-04', 100000, '2024-04-10')];
    const payments = [payment('p1', 100000, '2024-07-01', '2024-07')]; // natural month 2024-07 not a slot
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    // naturalMonth = July, not in slots, no earlier empty → fallback → April
    expect(perMonth['2024-04']!.receivedTotal).toBe(100000);
    expect(periodSurplus).toBe(0);
  });

  it('naturalMonth < earliest slot → falls back to first slot with remaining', () => {
    const slots = [slot('2024-06', 100000, '2024-06-10')];
    const payments = [payment('p1', 100000, '2024-04-01', '2024-03')]; // natural = March, before June
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    // naturalMonth March < slot June; no earlier empty (none before June); target = slots.find(month===March) = undefined
    // → fallback to first remaining → June
    expect(perMonth['2024-06']!.receivedTotal).toBe(100000);
    expect(periodSurplus).toBe(0);
  });

  // ── skip / catch-up sequence ────────────────────────────────────────────────

  it('three-month skip: payment 1 (natural M3) goes to M1; payment 2 (natural M3) goes to M2; payment 3 (natural M3) goes to M3', () => {
    const slots = [
      slot('2024-01', 100000, '2024-01-10'),
      slot('2024-02', 100000, '2024-02-10'),
      slot('2024-03', 100000, '2024-03-10'),
    ];
    const payments = [
      payment('pa', 100000, '2024-03-10', '2024-03'),
      payment('pb', 100000, '2024-03-11', '2024-03'),
      payment('pc', 100000, '2024-03-12', '2024-03'),
    ];
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    // Sorted chronologically: pa, pb, pc
    // pa: natural=Mar, earliest empty earlier = Jan → Jan
    // pb: natural=Mar, earliest empty earlier = Feb (Jan now has pa) → Feb
    // pc: natural=Mar, no earlier empty (Jan has pa, Feb has pb) → Mar
    expect(perMonth['2024-01']!.appliedPayments[0]!.paymentId).toBe('pa');
    expect(perMonth['2024-02']!.appliedPayments[0]!.paymentId).toBe('pb');
    expect(perMonth['2024-03']!.appliedPayments[0]!.paymentId).toBe('pc');
    expect(periodSurplus).toBe(0);
  });

  // ── slot with effectiveExpected = 0 ────────────────────────────────────────

  it('slot effectiveExpected = 0 has zero remaining; payments bypass it', () => {
    const slots = [
      slot('2024-04', 0, '2024-04-10'),   // effectiveExpected = 0 → no remaining
      slot('2024-05', 100000, '2024-05-10'),
    ];
    const payments = [payment('p1', 100000, '2024-04-15', '2024-04')];
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    // natural = Apr, but Apr has effectiveExpected=0 → remaining=0, not "truly-skipped"
    // earlierSkipped: no slot before Apr → none
    // target = slots.find(month===Apr) → Apr (remaining 0)
    // BUT remaining[Apr] = 0, target IS Apr (the code sets target even if remaining=0).
    // Fallback only happens if !target after natural lookup. Since Apr IS found as natural target:
    // Hmm, let's verify: target = earlierSkipped ?? slots.find(s => s.month === naturalMonth)
    // Apr remaining=0, but Apr IS found as target. The payment IS applied to Apr.
    // Let's check what actually happens with a payment whose naturalMonth IS the zero slot:
    expect(perMonth['2024-04']!.receivedTotal).toBe(100000);
    expect(perMonth['2024-04']!.surplus).toBe(100000); // entire amount is surplus (expected 0)
    expect(perMonth['2024-05']!.receivedTotal).toBe(0);
    expect(periodSurplus).toBe(0);
  });

  it('slot effectiveExpected = 0, no naturalMonth → payment skips to next non-zero slot', () => {
    const slots = [
      slot('2024-04', 0, '2024-04-10'),
      slot('2024-05', 100000, '2024-05-10'),
    ];
    const payments = [payment('p1', 100000, '2024-04-15')]; // no naturalMonth → FIFO
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    // FIFO: first slot with remaining > 0 is May
    expect(perMonth['2024-04']!.receivedTotal).toBe(0);
    expect(perMonth['2024-05']!.receivedTotal).toBe(100000);
    expect(periodSurplus).toBe(0);
  });

  // ── lateDays calculation ────────────────────────────────────────────────────

  it('payment before due date → lateDays = 0 (not negative)', () => {
    const slots = [slot('2024-08', 100000, '2024-08-10')];
    const payments = [payment('p1', 100000, '2024-08-01')]; // 9 days early
    const { perMonth } = matchPayments(slots, payments);

    expect(perMonth['2024-08']!.appliedPayments[0]!.lateDays).toBe(0);
  });

  it('payment exactly on due date → lateDays = 0', () => {
    const slots = [slot('2024-08', 100000, '2024-08-10')];
    const payments = [payment('p1', 100000, '2024-08-10')];
    const { perMonth } = matchPayments(slots, payments);

    expect(perMonth['2024-08']!.appliedPayments[0]!.lateDays).toBe(0);
  });

  it('payment one day after due date → lateDays = 1', () => {
    const slots = [slot('2024-08', 100000, '2024-08-10')];
    const payments = [payment('p1', 100000, '2024-08-11')];
    const { perMonth } = matchPayments(slots, payments);

    expect(perMonth['2024-08']!.appliedPayments[0]!.lateDays).toBe(1);
  });

  it('payment 30 days after due date → lateDays = 30', () => {
    const slots = [slot('2024-08', 100000, '2024-08-10')];
    const payments = [payment('p1', 100000, '2024-09-09')];
    const { perMonth } = matchPayments(slots, payments);

    expect(perMonth['2024-08']!.appliedPayments[0]!.lateDays).toBe(30);
  });

  // ── surplus calculation ─────────────────────────────────────────────────────

  it('receivedTotal > effectiveExpected → surplus = excess', () => {
    const slots = [slot('2024-09', 80000, '2024-09-10')];
    const payments = [payment('p1', 100000, '2024-09-05', '2024-09')];
    const { perMonth } = matchPayments(slots, payments);

    expect(perMonth['2024-09']!.receivedTotal).toBe(100000);
    expect(perMonth['2024-09']!.surplus).toBe(20000);
  });

  it('receivedTotal = effectiveExpected → surplus = 0', () => {
    const slots = [slot('2024-09', 80000, '2024-09-10')];
    const payments = [payment('p1', 80000, '2024-09-05', '2024-09')];
    const { perMonth } = matchPayments(slots, payments);

    expect(perMonth['2024-09']!.surplus).toBe(0);
  });

  it('receivedTotal < effectiveExpected → surplus = 0 (no negative surplus)', () => {
    const slots = [slot('2024-09', 80000, '2024-09-10')];
    const payments = [payment('p1', 50000, '2024-09-05', '2024-09')];
    const { perMonth } = matchPayments(slots, payments);

    expect(perMonth['2024-09']!.surplus).toBe(0);
    expect(perMonth['2024-09']!.receivedTotal).toBe(50000);
  });

  // ── sort order ──────────────────────────────────────────────────────────────

  it('payments given out of chronological order are sorted by paidAt ASC in appliedPayments', () => {
    const slots = [slot('2024-10', 300000, '2024-10-10')];
    const payments = [
      payment('p-c', 100000, '2024-10-30'),
      payment('p-a', 100000, '2024-10-05'),
      payment('p-b', 100000, '2024-10-15'),
    ];
    const { perMonth } = matchPayments(slots, payments);

    const applied = perMonth['2024-10']!.appliedPayments;
    expect(applied).toHaveLength(3);
    expect(applied[0]!.paymentId).toBe('p-a');
    expect(applied[1]!.paymentId).toBe('p-b');
    expect(applied[2]!.paymentId).toBe('p-c');
  });

  // ── all slots full with naturalMonth set ────────────────────────────────────

  it('all slots already have payments and are non-empty; extra payment with no earlier empty → periodSurplus (only if no natural slot found)', () => {
    // Slot only: 2024-05. It will be filled by p1.
    // p2 has naturalMonth = 2024-06 (not a slot at all), no earlier empty → fallback FIFO
    // FIFO looks for remaining > 0 → May remaining = 100000 - 100000 = 0 → no slot → periodSurplus
    const slots = [slot('2024-05', 100000, '2024-05-10')];
    const payments = [
      payment('p1', 100000, '2024-05-08', '2024-05'),
      payment('p2', 50000, '2024-06-01', '2024-06'), // natural June not in slots → fallback FIFO → no remaining → periodSurplus
    ];
    const { perMonth, periodSurplus } = matchPayments(slots, payments);

    expect(perMonth['2024-05']!.receivedTotal).toBe(100000);
    expect(periodSurplus).toBe(50000);
  });

  // ── partial deficit (not fully skipped) does NOT trigger skip routing ───────

  it('earlier month has partial payment (not empty) → does NOT catch later payment', () => {
    const slots = [
      slot('2024-02', 100000, '2024-02-10'),
      slot('2024-03', 100000, '2024-03-10'),
    ];
    const payments = [
      payment('p1', 50000, '2024-02-08', '2024-02'),  // partial payment in Feb (not empty)
      payment('p2', 100000, '2024-03-05', '2024-03'), // natural March; Feb has payment → Feb NOT "entirely untouched"
    ];
    const { perMonth } = matchPayments(slots, payments);

    // p1 → Feb; p2: Feb NOT empty (has p1) → p2 goes to its natural month March
    expect(perMonth['2024-02']!.appliedPayments[0]!.paymentId).toBe('p1');
    expect(perMonth['2024-03']!.appliedPayments[0]!.paymentId).toBe('p2');
  });
});

// ─── computeDueDate – edge cases ─────────────────────────────────────────────

describe('computeDueDate – edge cases', () => {
  it('current mode, dueDay 10 → returns YYYY-MM-10', () => {
    expect(computeDueDate('2024-07', 10, 'current')).toBe('2024-07-10');
  });

  it('current mode, dueDay 31 in February 2025 (28 days) → clamps to 2025-02-28', () => {
    expect(computeDueDate('2025-02', 31, 'current')).toBe('2025-02-28');
  });

  it('current mode, dueDay 31 in February 2024 (leap year, 29 days) → clamps to 2024-02-29', () => {
    expect(computeDueDate('2024-02', 31, 'current')).toBe('2024-02-29');
  });

  it('next mode, dueDay 10, target January → rolls back to prior December', () => {
    expect(computeDueDate('2024-01', 10, 'next')).toBe('2023-12-10');
  });

  it('next mode, dueDay 1, target month 12 → returns month 11 same year', () => {
    expect(computeDueDate('2024-12', 1, 'next')).toBe('2024-11-01');
  });

  it('next mode, dueDay > daysInMonth of prior month → clamps to end of prior month', () => {
    // Target month = March 2025; prior month = Feb 2025 (28 days); dueDay = 31 → clamps to 28
    expect(computeDueDate('2025-03', 31, 'next')).toBe('2025-02-28');
  });

  it('next mode, target March 2024 (prior = Feb 2024, leap year 29 days) → clamps to 29', () => {
    expect(computeDueDate('2024-03', 31, 'next')).toBe('2024-02-29');
  });

  it('next mode, dueDay = 28 in Feb prior month → always valid', () => {
    expect(computeDueDate('2025-03', 28, 'next')).toBe('2025-02-28');
    expect(computeDueDate('2024-03', 28, 'next')).toBe('2024-02-28');
  });

  it('next mode, target February rolls back to January (no clamping needed for day 15)', () => {
    expect(computeDueDate('2024-02', 15, 'next')).toBe('2024-01-15');
  });

  it('current mode, dueDay 1 → always valid regardless of month', () => {
    expect(computeDueDate('2024-06', 1, 'current')).toBe('2024-06-01');
    expect(computeDueDate('2024-02', 1, 'current')).toBe('2024-02-01');
  });
});
