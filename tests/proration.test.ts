import { describe, it, expect } from 'vitest';
import { computeDeductibleForPeriod } from '../src/lib/proration.js';

interface Tariff {
  validFrom: string;
  validTo: string | null;
  deductibleAmount: number;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function tariff(validFrom: string, validTo: string | null, deductibleAmount: number): Tariff {
  return { validFrom, validTo, deductibleAmount };
}

// ─── computeDeductibleForPeriod ───────────────────────────────────────────────

describe('computeDeductibleForPeriod', () => {
  // ── empty tariffs ───────────────────────────────────────────────────────────

  it('empty tariffs → {totalHaler: 0, daysCovered: 0}', () => {
    const result = computeDeductibleForPeriod([], '2024-01-01', '2024-03-31');
    expect(result).toEqual({ totalHaler: 0, daysCovered: 0 });
  });

  // ── single tariff covering entire period ────────────────────────────────────

  it('single tariff covering entire month → totalHaler = deductibleAmount', () => {
    // January 2024 = 31 days; tariff covers the whole month
    const tariffs = [tariff('2024-01-01', null, 31000)];
    const result = computeDeductibleForPeriod(tariffs, '2024-01-01', '2024-01-31');
    // 31000 * 31 / 31 = 31000
    expect(result.totalHaler).toBe(31000);
    expect(result.daysCovered).toBe(31);
  });

  it('single open-ended tariff, period is partial month → prorates correctly', () => {
    // April 2024 = 30 days; tariff 6000 per month; period = first 15 days
    const tariffs = [tariff('2024-04-01', null, 6000)];
    const result = computeDeductibleForPeriod(tariffs, '2024-04-01', '2024-04-15');
    // Math.round(6000 * 15 / 30) = Math.round(3000) = 3000
    expect(result.totalHaler).toBe(3000);
    expect(result.daysCovered).toBe(15);
  });

  it('single tariff covering full period of multiple months', () => {
    // Jan + Feb 2024 (31 + 29 = 60 days; 2024 is leap)
    const tariffs = [tariff('2024-01-01', null, 31000)];
    const result = computeDeductibleForPeriod(tariffs, '2024-01-01', '2024-02-29');
    // Jan: 31000 * 31/31 = 31000; Feb: 31000 * 29/29 = 31000; total = 62000
    expect(result.totalHaler).toBe(62000);
    expect(result.daysCovered).toBe(60);
  });

  // ── period entirely before any tariff ──────────────────────────────────────

  it('period entirely before the tariff validFrom → {totalHaler: 0, daysCovered: 0}', () => {
    const tariffs = [tariff('2025-01-01', null, 5000)];
    const result = computeDeductibleForPeriod(tariffs, '2024-01-01', '2024-12-31');
    expect(result).toEqual({ totalHaler: 0, daysCovered: 0 });
  });

  it('period starting exactly at tariff validFrom mid-month → tariff is found and prorates from that day', () => {
    // Tariff starts 2024-03-15; period is 2024-03-15 to 2024-03-31 (17 days)
    // firstActive = max('2024-03-15', '2024-03-15') = '2024-03-15'
    // validAtTariff(tariffs, '2024-03-15') finds tariff (validFrom='2024-03-15' <= '2024-03-15') ✓
    // Math.round(3100 * 17 / 31) = 1700
    const tariffs = [tariff('2024-03-15', null, 3100)];
    const result = computeDeductibleForPeriod(tariffs, '2024-03-15', '2024-03-31');
    expect(result.totalHaler).toBe(Math.round(3100 * 17 / 31));
    expect(result.daysCovered).toBe(17);
  });

  it('period starts before tariff validFrom within the same month → tariff lookup uses periodFrom date, tariff not yet valid → 0 (known limitation)', () => {
    // BUG NOTE: computeDeductibleForPeriod looks up tariff using firstActive = max(periodFrom, monthStart).
    // When periodFrom='2024-03-01' and tariffValidFrom='2024-03-15', firstActive='2024-03-01' and
    // validAtTariff(tariffs, '2024-03-01') returns null because '2024-03-15' > '2024-03-01'.
    // The entire month-segment returns 0 even though the tariff is valid for days 15-31.
    // This is a known limitation: the function does NOT split a month at tariff boundaries —
    // it uses one tariff per month, looked up at the month's firstActive date.
    const tariffs = [tariff('2024-03-15', null, 3100)];
    const result = computeDeductibleForPeriod(tariffs, '2024-03-01', '2024-03-31');
    expect(result.totalHaler).toBe(0);
    expect(result.daysCovered).toBe(0);
  });

  // ── period entirely after all tariffs ──────────────────────────────────────

  it('period entirely after all tariffs with validTo set → {totalHaler: 0, daysCovered: 0}', () => {
    const tariffs = [tariff('2023-01-01', '2023-12-31', 5000)];
    const result = computeDeductibleForPeriod(tariffs, '2024-01-01', '2024-03-31');
    expect(result).toEqual({ totalHaler: 0, daysCovered: 0 });
  });

  it('period after tariff start with open-ended tariff (validTo=null) → continues to apply', () => {
    const tariffs = [tariff('2020-01-01', null, 3000)];
    const result = computeDeductibleForPeriod(tariffs, '2024-06-01', '2024-06-30');
    // June 2024 = 30 days; Math.round(3000 * 30/30) = 3000
    expect(result.totalHaler).toBe(3000);
    expect(result.daysCovered).toBe(30);
  });

  // ── tariff transition mid-period ────────────────────────────────────────────

  it('tariff changes at start of a month within the period → each month uses its tariff', () => {
    // Jan: 3100; Feb onwards: 4000
    const tariffs = [
      tariff('2024-01-01', '2024-02-01', 3100),
      tariff('2024-02-01', null, 4000),
    ];
    // Period: Jan + Feb 2024
    const result = computeDeductibleForPeriod(tariffs, '2024-01-01', '2024-02-29');
    // Jan: validAt('2024-01-01') → tariff1 → Math.round(3100 * 31/31) = 3100
    // Feb: validAt('2024-02-01') → tariff2 (validFrom<=date, validTo=null) → Math.round(4000 * 29/29) = 4000
    // Note: tariff1 validTo='2024-02-01' and condition is date < validTo → '2024-02-01' < '2024-02-01' = false
    //       so tariff2 applies for Feb. tariff2 validFrom='2024-02-01' <= '2024-02-01' ✓
    expect(result.totalHaler).toBe(3100 + 4000);
    expect(result.daysCovered).toBe(31 + 29);
  });

  it('tariff transition mid-month: period starts from firstActive which is past month start', () => {
    // Period 2024-01-15 to 2024-02-29; tariff A until Feb, tariff B from Feb
    const tariffs = [
      tariff('2024-01-01', '2024-02-01', 3100),
      tariff('2024-02-01', null, 4000),
    ];
    const result = computeDeductibleForPeriod(tariffs, '2024-01-15', '2024-02-29');
    // Jan: firstActive = max('2024-01-01', '2024-01-15') = '2024-01-15'; days = 31-15+1 = 17
    //      tariff used: validAt('2024-01-15') → tariff A → Math.round(3100 * 17/31) = Math.round(1700) = 1700
    // Feb: firstActive='2024-02-01', days=29; tariff B → 4000
    expect(result.totalHaler).toBe(Math.round(3100 * 17 / 31) + 4000);
    expect(result.daysCovered).toBe(17 + 29);
  });

  // ── single month period ────────────────────────────────────────────────────

  it('period of single month: daysCovered = days in that month', () => {
    const tariffs = [tariff('2024-05-01', null, 3000)];
    const result = computeDeductibleForPeriod(tariffs, '2024-05-01', '2024-05-31');
    // May = 31 days
    expect(result.daysCovered).toBe(31);
    expect(result.totalHaler).toBe(3000); // 3000 * 31/31 = 3000
  });

  it('period of single day → daysCovered = 1, totalHaler = prorated for that day', () => {
    // March has 31 days
    const tariffs = [tariff('2024-03-01', null, 3100)];
    const result = computeDeductibleForPeriod(tariffs, '2024-03-01', '2024-03-01');
    expect(result.daysCovered).toBe(1);
    expect(result.totalHaler).toBe(Math.round(3100 * 1 / 31)); // = 100
  });

  // ── multi-year period ──────────────────────────────────────────────────────

  it('period spanning multiple years iterates correctly', () => {
    // Dec 2023 + Jan 2024 + Feb 2024 (2024 is leap)
    const tariffs = [tariff('2023-01-01', null, 3000)];
    const result = computeDeductibleForPeriod(tariffs, '2023-12-01', '2024-02-29');
    // Dec 2023: 31 days → Math.round(3000 * 31/31) = 3000
    // Jan 2024: 31 days → 3000
    // Feb 2024: 29 days → Math.round(3000 * 29/29) = 3000
    expect(result.totalHaler).toBe(9000);
    expect(result.daysCovered).toBe(31 + 31 + 29);
  });

  it('period crossing year boundary with tariff transition at new year', () => {
    const tariffs = [
      tariff('2023-01-01', '2024-01-01', 2000),
      tariff('2024-01-01', null, 4000),
    ];
    // Dec 2023 + Jan 2024
    const result = computeDeductibleForPeriod(tariffs, '2023-12-01', '2024-01-31');
    // Dec 2023: validAt('2023-12-01') → tariff1 (2000) → Math.round(2000 * 31/31) = 2000
    // Jan 2024: validAt('2024-01-01') → tariff1 validTo='2024-01-01', '2024-01-01' < '2024-01-01' = false
    //           → tariff2 (4000) → Math.round(4000 * 31/31) = 4000
    expect(result.totalHaler).toBe(2000 + 4000);
    expect(result.daysCovered).toBe(31 + 31);
  });

  // ── deductibleAmount = 0 ───────────────────────────────────────────────────

  it('tariff with deductibleAmount = 0 → totalHaler = 0 but daysCovered is still counted', () => {
    // The implementation: if (tariff) { total += ...; totalDays += days; }
    // Even with deductibleAmount=0, totalDays is incremented when a tariff exists
    const tariffs = [tariff('2024-01-01', null, 0)];
    const result = computeDeductibleForPeriod(tariffs, '2024-01-01', '2024-01-31');
    expect(result.totalHaler).toBe(0);
    // daysCovered should be 31 because a tariff was found and days were added
    expect(result.daysCovered).toBe(31);
  });

  // ── period ending before month end (partial last month) ───────────────────

  it('period ending mid-month → lastActive clamps to periodTo, not monthEnd', () => {
    // Period: 2024-06-01 to 2024-06-20 (20 days, June has 30 days)
    const tariffs = [tariff('2024-06-01', null, 3000)];
    const result = computeDeductibleForPeriod(tariffs, '2024-06-01', '2024-06-20');
    expect(result.daysCovered).toBe(20);
    expect(result.totalHaler).toBe(Math.round(3000 * 20 / 30)); // = 2000
  });

  // ── multiple tariffs, only one valid at any point ─────────────────────────

  it('two tariffs with gap between them → only covered days count, gap is zero', () => {
    // Tariff A: Jan 2024; Tariff B: Mar 2024 onwards; period covers Jan-Mar
    const tariffs = [
      tariff('2024-01-01', '2024-02-01', 3100), // covers Jan only
      tariff('2024-03-01', null, 3000),           // starts Mar
    ];
    const result = computeDeductibleForPeriod(tariffs, '2024-01-01', '2024-03-31');
    // Jan: tariff A → 3100 (31 days)
    // Feb: validAt('2024-02-01') → tariff A validTo='2024-02-01', not valid; tariff B validFrom='2024-03-01' > Feb → no tariff
    // Mar: validAt('2024-03-01') → tariff B → Math.round(3000 * 31/31) = 3000 (31 days)
    expect(result.totalHaler).toBe(3100 + 3000);
    expect(result.daysCovered).toBe(31 + 31); // Feb not counted (no tariff)
  });

  // ── rounding: ensure Math.round is used (not floor or ceil) ────────────────

  it('proration uses Math.round (not floor)', () => {
    // 3 days out of 31; deductibleAmount = 1000
    // 1000 * 3/31 = 96.77... → Math.round = 97
    const tariffs = [tariff('2024-01-01', null, 1000)];
    const result = computeDeductibleForPeriod(tariffs, '2024-01-01', '2024-01-03');
    expect(result.totalHaler).toBe(Math.round(1000 * 3 / 31));
    expect(result.daysCovered).toBe(3);
  });
});
