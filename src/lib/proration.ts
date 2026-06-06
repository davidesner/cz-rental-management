interface TariffLike {
  validFrom: string;
  validTo: string | null;
  deductibleAmount: number;
}

function daysInMonthUtc(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validAtTariff<T extends TariffLike>(rows: T[], date: string): T | null {
  for (const r of rows) {
    if (r.validFrom <= date && (r.validTo === null || date < r.validTo)) return r;
  }
  return null;
}

/**
 * Compute total deductible (haléře) over [periodFrom, periodTo] given tariff history.
 * Returns 0 if no tariffs cover the period.
 */
export function computeDeductibleForPeriod(
  tariffs: TariffLike[],
  periodFrom: string,
  periodTo: string,
): { totalHaler: number; daysCovered: number } {
  let total = 0;
  let totalDays = 0;
  const [y0, m0] = periodFrom.split('-').map(Number) as [number, number, number];
  const [y1, m1] = periodTo.split('-').map(Number) as [number, number, number];
  let y = y0, m = m0;
  while (y < y1 || (y === y1 && m <= m1)) {
    const dim = daysInMonthUtc(y, m);
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;
    const firstActive = periodFrom > monthStart ? periodFrom : monthStart;
    const lastActive = periodTo < monthEnd ? periodTo : monthEnd;
    if (firstActive <= lastActive) {
      const start = new Date(firstActive + 'T00:00:00Z');
      const end = new Date(lastActive + 'T00:00:00Z');
      const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      const tariff = validAtTariff(tariffs, firstActive);
      if (tariff) {
        total += Math.round(tariff.deductibleAmount * days / dim);
        totalDays += days;
      }
    }
    m++; if (m > 12) { y++; m = 1; }
  }
  return { totalHaler: total, daysCovered: totalDays };
}
