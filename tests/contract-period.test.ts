import { describe, it, expect } from 'vitest';
import { nextPeriodEnd, effectiveEndDate } from '../core/lib/contract-period.js';

describe('contract-period', () => {
  describe('nextPeriodEnd', () => {
    it('adds whole months, keeping month-ends on month-ends', () => {
      expect(nextPeriodEnd('2025-12-31', 12)).toBe('2026-12-31');
      expect(nextPeriodEnd('2025-06-30', 6)).toBe('2025-12-31');
      expect(nextPeriodEnd('2025-01-31', 1)).toBe('2025-02-28');
      expect(nextPeriodEnd('2024-02-29', 12)).toBe('2025-02-28');
      expect(nextPeriodEnd('2025-02-28', 12)).toBe('2026-02-28');
    });

    it('keeps a mid-month day of month', () => {
      expect(nextPeriodEnd('2025-09-14', 12)).toBe('2026-09-14');
      expect(nextPeriodEnd('2025-11-14', 3)).toBe('2026-02-14');
    });
  });

  describe('effectiveEndDate', () => {
    const renewing = { endDate: '2025-12-31', autoRenew: true, renewalMonths: 12 };

    it('returns the original end while still inside the fixed term', () => {
      expect(effectiveEndDate(renewing, '2025-06-01')).toBe('2025-12-31');
      expect(effectiveEndDate(renewing, '2025-12-31')).toBe('2025-12-31');
    });

    it('rolls forward to the renewal period that contains asOf', () => {
      expect(effectiveEndDate(renewing, '2026-01-01')).toBe('2026-12-31');
      expect(effectiveEndDate(renewing, '2026-03-05')).toBe('2026-12-31');
      expect(effectiveEndDate(renewing, '2028-01-10')).toBe('2028-12-31');
    });

    it('leaves a non-renewing or open-ended contract alone', () => {
      expect(effectiveEndDate({ ...renewing, autoRenew: false }, '2027-01-01')).toBe('2025-12-31');
      expect(effectiveEndDate({ ...renewing, endDate: null }, '2027-01-01')).toBeNull();
      expect(effectiveEndDate({ ...renewing, renewalMonths: null }, '2027-01-01')).toBe('2025-12-31');
    });
  });
});
