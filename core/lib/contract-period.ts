/**
 * Automatic renewal (prolongace) of a fixed-term lease.
 *
 * A renewing contract keeps its ORIGINAL `endDate`; the effective end is
 * derived by rolling it forward in `renewalMonths` steps. Nothing is persisted
 * per renewal, so a payment arriving the day after the original end still
 * pairs without anyone having to move `endDate` first.
 */
export interface RenewableContract {
  endDate: string | null;   // YYYY-MM-DD, original end of the fixed term
  autoRenew: boolean;
  renewalMonths: number | null;
}

/**
 * End of the renewal period that follows the one ending on `end`: the same
 * day `months` later, except that a month-end stays a month-end
 * (2025-06-30 + 6 → 2025-12-31, 2024-02-29 + 12 → 2025-02-28).
 */
export function nextPeriodEnd(end: string, months: number): string {
  const [y, m, d] = end.split('-').map(Number) as [number, number, number];
  const daysIn = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const idx = (m - 1) + months;
  const ty = y + Math.floor(idx / 12);
  const tm = (idx % 12) + 1;
  const last = daysIn(ty, tm);
  const td = d === daysIn(y, m) ? last : Math.min(d, last);
  return `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
}

/**
 * The contract's end as seen on `asOf`: for a renewing contract, the end of
 * the renewal period that contains `asOf` (or the original end if `asOf` is
 * still inside the fixed term). Null means open-ended.
 */
export function effectiveEndDate(c: RenewableContract, asOf: string): string | null {
  if (c.endDate === null || !c.autoRenew || !c.renewalMonths || c.renewalMonths < 1) return c.endDate;
  let end = c.endDate;
  while (end < asOf) end = nextPeriodEnd(end, c.renewalMonths);
  return end;
}
