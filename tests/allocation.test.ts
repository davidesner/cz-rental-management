import { describe, it, expect } from 'vitest';
import { allocate, expectedForMonth, monthCoverage, UTILITY_ORDER } from '../core/lib/allocation.js';

describe('monthCoverage', () => {
  it('full month when contract entirely covers', () => {
    const c = monthCoverage(2024, 10, '2024-09-20', null);
    expect(c.daysActive).toBe(31);
    expect(c.daysInMonth).toBe(31);
  });
  it('partial month at contract start', () => {
    const c = monthCoverage(2024, 9, '2024-09-20', null);
    expect(c.daysActive).toBe(11);
    expect(c.daysInMonth).toBe(30);
  });
  it('zero days before contract start', () => {
    const c = monthCoverage(2024, 8, '2024-09-20', null);
    expect(c.daysActive).toBe(0);
  });
});

describe('expectedForMonth', () => {
  const terms = [{ validFrom: '2024-09-20', validTo: null, baseRent: 3300000, serviceAdvance: 700000 }];
  const utilities = [{ kind: 'electricity' as const, validFrom: '2024-09-20', validTo: null, monthlyAdvance: 120000 }];

  it('full month (October)', () => {
    const e = expectedForMonth(2024, 10, '2024-09-20', null, terms, utilities);
    expect(e.baseRent).toBe(3300000);
    expect(e.serviceAdvance).toBe(700000);
    expect(e.utilities.electricity).toBe(120000);
  });
  it('partial month (September, 11/30)', () => {
    const e = expectedForMonth(2024, 9, '2024-09-20', null, terms, utilities);
    expect(e.baseRent).toBe(1210000); // 33000 × 11/30 = 12100 exact
    expect(e.serviceAdvance).toBe(Math.round(700000 * 11 / 30)); // ≈ 256667
    expect(e.utilities.electricity).toBe(44000);    // 1200 × 11/30 = 440 exact
  });
});

describe('allocate', () => {
  const expectation = {
    baseRent: 3300000, serviceAdvance: 700000,
    utilities: { electricity: 120000, gas: 0, internet: 0, water: 0, other: 0 },
    daysActive: 31, daysInMonth: 31,
  };

  it('full payment allocates everything', () => {
    const a = allocate(4120000, expectation);
    expect(a.baseRentPaid).toBe(3300000);
    expect(a.servicePaid).toBe(700000);
    expect(a.utilityPaid.electricity).toBe(120000);
    expect(a.surplus).toBe(0);
    expect(a.deficit.baseRent).toBe(0);
  });

  it('rent-first: deficit lands on advances (utilities are last)', () => {
    const a = allocate(3890000, expectation); // 4120000 - 230000 short
    expect(a.baseRentPaid).toBe(3300000);        // rent fully covered first
    expect(a.servicePaid).toBe(590000);          // service partially covered (700000 - 110000)
    expect(a.utilityPaid.electricity).toBe(0);   // electricity gets nothing (rent + partial service consumed it all)
    expect(a.deficit.baseRent).toBe(0);
    expect(a.deficit.serviceAdvance).toBe(110000);
    expect(a.deficit.utilities.electricity).toBe(120000);
  });

  it('rent-first: small deficit lands on last utility', () => {
    const a = allocate(4119400, expectation); // 4120000 - 600 short
    expect(a.baseRentPaid).toBe(3300000);
    expect(a.servicePaid).toBe(700000);
    expect(a.utilityPaid.electricity).toBe(119400);
    expect(a.deficit.utilities.electricity).toBe(600);
  });

  it('overpayment shows surplus', () => {
    const a = allocate(5000000, expectation);
    expect(a.surplus).toBe(5000000 - (3300000 + 700000 + 120000));
  });
});
