import { describe, it, expect } from 'vitest';
import { allocate, expectedForMonth, monthCoverage } from '../core/lib/allocation.js';

// ---------------------------------------------------------------------------
// monthCoverage – edge cases
// ---------------------------------------------------------------------------
describe('monthCoverage edge cases', () => {
  it('contract starts on day 1 of month — daysActive equals daysInMonth', () => {
    const c = monthCoverage(2024, 3, '2024-03-01', null);
    expect(c.daysActive).toBe(31);
    expect(c.daysInMonth).toBe(31);
  });

  it('contract starts on last day of month — daysActive is 1', () => {
    const c = monthCoverage(2024, 3, '2024-03-31', null);
    expect(c.daysActive).toBe(1);
    expect(c.daysInMonth).toBe(31);
  });

  it('contract ends before month start — daysActive is 0', () => {
    // Contract ends 2024-02-28; looking at March 2024
    const c = monthCoverage(2024, 3, '2024-01-01', '2024-02-28');
    expect(c.daysActive).toBe(0);
    expect(c.daysInMonth).toBe(31);
  });

  it('contract ends mid-month — only those days are active', () => {
    // Contract ends on the 15th; March has 31 days
    const c = monthCoverage(2024, 3, '2024-01-01', '2024-03-15');
    expect(c.daysActive).toBe(15);
    expect(c.daysInMonth).toBe(31);
  });

  it('contract starts AND ends within same month — daysActive spans only those days', () => {
    // 2024-03-10 to 2024-03-20 = 11 days inclusive
    const c = monthCoverage(2024, 3, '2024-03-10', '2024-03-20');
    expect(c.daysActive).toBe(11);
    expect(c.daysInMonth).toBe(31);
  });

  it('leap year February 2024 — daysInMonth is 29 and full coverage is 29', () => {
    const c = monthCoverage(2024, 2, '2024-01-01', null);
    expect(c.daysInMonth).toBe(29);
    expect(c.daysActive).toBe(29);
  });

  it('non-leap year February 2025 — daysInMonth is 28 and full coverage is 28', () => {
    const c = monthCoverage(2025, 2, '2025-01-01', null);
    expect(c.daysInMonth).toBe(28);
    expect(c.daysActive).toBe(28);
  });

  it('month=12 (December) resolves daysInMonth correctly (31)', () => {
    const c = monthCoverage(2024, 12, '2024-01-01', null);
    expect(c.daysInMonth).toBe(31);
    expect(c.daysActive).toBe(31);
  });
});

// ---------------------------------------------------------------------------
// expectedForMonth – edge cases
// ---------------------------------------------------------------------------
describe('expectedForMonth edge cases', () => {
  it('no terms valid for the month — returns all zeros', () => {
    // Terms only valid from 2025 onwards; looking at 2024-03
    const terms = [{ validFrom: '2025-01-01', validTo: null, baseRent: 3000000, serviceAdvance: 500000 }];
    const e = expectedForMonth(2024, 3, '2024-03-01', null, terms, []);
    expect(e.baseRent).toBe(0);
    expect(e.serviceAdvance).toBe(0);
    expect(e.utilities).toEqual({ electricity: 0, gas: 0, internet: 0, water: 0, other: 0 });
  });

  it('terms transition mid-month — uses term valid at firstActive date', () => {
    // Contract starts 2024-03-10 so firstActive='2024-03-10'.
    // termA valid [2024-03-01, 2024-03-10) — NOT valid at 2024-03-10 (exclusive upper bound).
    // termB valid [2024-03-10, null)         — VALID at 2024-03-10.
    // Expect proration of termB over 22 active days (2024-03-10..2024-03-31).
    const terms = [
      { validFrom: '2024-03-01', validTo: '2024-03-10', baseRent: 2000000, serviceAdvance: 400000 },
      { validFrom: '2024-03-10', validTo: null,          baseRent: 3000000, serviceAdvance: 600000 },
    ];
    const e = expectedForMonth(2024, 3, '2024-03-10', null, terms, []);
    // 22 active days out of 31
    expect(e.daysActive).toBe(22);
    expect(e.baseRent).toBe(Math.round(3000000 * 22 / 31));     // 2129032
    expect(e.serviceAdvance).toBe(Math.round(600000 * 22 / 31)); // 425806
  });

  it('multiple utility kinds — all prorated correctly', () => {
    const terms = [{ validFrom: '2024-03-01', validTo: null, baseRent: 1000000, serviceAdvance: 200000 }];
    const utilities = [
      { kind: 'electricity' as const, validFrom: '2024-03-01', validTo: null, monthlyAdvance: 120000 },
      { kind: 'gas'         as const, validFrom: '2024-03-01', validTo: null, monthlyAdvance:  60000 },
      { kind: 'internet'    as const, validFrom: '2024-03-01', validTo: null, monthlyAdvance:  30000 },
    ];
    // Full month — no proration needed
    const e = expectedForMonth(2024, 3, '2024-03-01', null, terms, utilities);
    expect(e.utilities.electricity).toBe(120000);
    expect(e.utilities.gas).toBe(60000);
    expect(e.utilities.internet).toBe(30000);
    expect(e.utilities.water).toBe(0);
    expect(e.utilities.other).toBe(0);
  });

  it('same utility kind with multiple SCD2 rows — picks the row active at firstActive', () => {
    // firstActive = 2024-09-20, so the first row (validTo='2024-09-20') is no longer valid (exclusive bound)
    const terms = [{ validFrom: '2024-09-01', validTo: null, baseRent: 1000000, serviceAdvance: 100000 }];
    const utilities = [
      { kind: 'electricity' as const, validFrom: '2024-09-01', validTo: '2024-09-20', monthlyAdvance: 100000 },
      { kind: 'electricity' as const, validFrom: '2024-09-20', validTo: null,          monthlyAdvance: 200000 },
    ];
    const e = expectedForMonth(2024, 9, '2024-09-20', null, terms, utilities);
    // active: 2024-09-20..2024-09-30 = 11 days out of 30
    expect(e.daysActive).toBe(11);
    expect(e.utilities.electricity).toBe(Math.round(200000 * 11 / 30)); // 73333
  });

  it('partial month (11/30 days) prorates Math.round(amount × 11/30)', () => {
    const terms = [{ validFrom: '2024-09-20', validTo: null, baseRent: 3300000, serviceAdvance: 700000 }];
    const utilities = [{ kind: 'electricity' as const, validFrom: '2024-09-20', validTo: null, monthlyAdvance: 120000 }];
    const e = expectedForMonth(2024, 9, '2024-09-20', null, terms, utilities);
    expect(e.daysActive).toBe(11);
    expect(e.daysInMonth).toBe(30);
    expect(e.baseRent).toBe(Math.round(3300000 * 11 / 30));         // 1210000
    expect(e.serviceAdvance).toBe(Math.round(700000 * 11 / 30));    // 256667
    expect(e.utilities.electricity).toBe(Math.round(120000 * 11 / 30)); // 44000
  });
});

// ---------------------------------------------------------------------------
// allocate – edge cases
// ---------------------------------------------------------------------------
describe('allocate edge cases', () => {
  const baseExpectation = {
    baseRent: 3300000,
    serviceAdvance: 700000,
    utilities: { electricity: 120000, gas: 0, internet: 0, water: 0, other: 0 },
    daysActive: 31,
    daysInMonth: 31,
  };

  it('payment exactly equal to baseRent — service and utilities fully unpaid', () => {
    const a = allocate(3300000, baseExpectation);
    expect(a.baseRentPaid).toBe(3300000);
    expect(a.servicePaid).toBe(0);
    expect(a.utilityPaid.electricity).toBe(0);
    expect(a.surplus).toBe(0);
    expect(a.deficit.baseRent).toBe(0);
    expect(a.deficit.serviceAdvance).toBe(700000);
    expect(a.deficit.utilities.electricity).toBe(120000);
  });

  it('payment > baseRent + service but < total — utilities partially covered', () => {
    // baseRent(3300000) + service(700000) = 4000000; total = 4120000
    // received = 4060000 → 60000 towards electricity (120000 expected), deficit = 60000
    const a = allocate(4060000, baseExpectation);
    expect(a.baseRentPaid).toBe(3300000);
    expect(a.servicePaid).toBe(700000);
    expect(a.utilityPaid.electricity).toBe(60000);
    expect(a.surplus).toBe(0);
    expect(a.deficit.baseRent).toBe(0);
    expect(a.deficit.serviceAdvance).toBe(0);
    expect(a.deficit.utilities.electricity).toBe(60000);
  });

  it('expectation with all zero amounts — surplus equals received', () => {
    const zeroExpectation = {
      baseRent: 0,
      serviceAdvance: 0,
      utilities: { electricity: 0, gas: 0, internet: 0, water: 0, other: 0 },
      daysActive: 31,
      daysInMonth: 31,
    };
    const a = allocate(5000, zeroExpectation);
    expect(a.baseRentPaid).toBe(0);
    expect(a.servicePaid).toBe(0);
    expect(a.utilityPaid).toEqual({ electricity: 0, gas: 0, internet: 0, water: 0, other: 0 });
    expect(a.surplus).toBe(5000);
    expect(a.deficit).toEqual({ baseRent: 0, serviceAdvance: 0, utilities: { electricity: 0, gas: 0, internet: 0, water: 0, other: 0 } });
  });

  it('payment of 0 — all paid fields are 0 and deficit equals full expectation', () => {
    const a = allocate(0, baseExpectation);
    expect(a.baseRentPaid).toBe(0);
    expect(a.servicePaid).toBe(0);
    expect(a.utilityPaid).toEqual({ electricity: 0, gas: 0, internet: 0, water: 0, other: 0 });
    expect(a.surplus).toBe(0);
    expect(a.deficit.baseRent).toBe(3300000);
    expect(a.deficit.serviceAdvance).toBe(700000);
    expect(a.deficit.utilities.electricity).toBe(120000);
  });

  it('multiple utility kinds filled in UTILITY_ORDER (electricity → gas → internet → water → other)', () => {
    const multiExpectation = {
      baseRent: 10000,
      serviceAdvance: 5000,
      utilities: { electricity: 1000, gas: 2000, internet: 3000, water: 4000, other: 5000 },
      daysActive: 31,
      daysInMonth: 31,
    };
    // total = 10000+5000+1000+2000+3000+4000+5000 = 30000
    // received = 25000 → covers baseRent, service, electricity, gas, internet, water (21000) → 4000/4000 water → remaining=0, other unpaid
    const a = allocate(25000, multiExpectation);
    expect(a.baseRentPaid).toBe(10000);
    expect(a.servicePaid).toBe(5000);
    expect(a.utilityPaid.electricity).toBe(1000);
    expect(a.utilityPaid.gas).toBe(2000);
    expect(a.utilityPaid.internet).toBe(3000);
    expect(a.utilityPaid.water).toBe(4000);
    expect(a.utilityPaid.other).toBe(0);
    expect(a.surplus).toBe(0);
    expect(a.deficit.utilities.other).toBe(5000);
    expect(a.deficit.utilities.water).toBe(0);
  });

  it('deficit is capped at expectation amount — never negative', () => {
    // Pay more than one utility but exactly match another
    const exactExpectation = {
      baseRent: 1000,
      serviceAdvance: 500,
      utilities: { electricity: 200, gas: 0, internet: 0, water: 0, other: 0 },
      daysActive: 31,
      daysInMonth: 31,
    };
    const a = allocate(1700, exactExpectation);
    // 1000 + 500 + 200 = 1700 exactly
    expect(a.deficit.baseRent).toBe(0);
    expect(a.deficit.serviceAdvance).toBe(0);
    expect(a.deficit.utilities.electricity).toBe(0);
    expect(a.surplus).toBe(0);
  });
});
