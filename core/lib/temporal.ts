/**
 * Pick the row from `rows` whose [validFrom, validTo) window contains `date`.
 * Open `validTo` (null) means "valid from validFrom onwards".
 * Returns null if no row covers the date.
 */
export interface TemporalRow {
  validFrom: string; // YYYY-MM-DD
  validTo: string | null;
}

export function validAt<T extends TemporalRow>(rows: T[], date: string): T | null {
  for (const r of rows) {
    if (r.validFrom <= date && (r.validTo === null || date < r.validTo)) {
      return r;
    }
  }
  return null;
}

/**
 * Find any row whose window is open (validTo is null) — there should be at most one
 * for a given parent (property/contract). Helper for SCD2 close-then-insert.
 */
export function openRow<T extends TemporalRow>(rows: T[]): T | null {
  return rows.find((r) => r.validTo === null) ?? null;
}

/**
 * Pick all rows that overlap the [from, to) range.
 */
export function overlapping<T extends TemporalRow>(rows: T[], from: string, to: string): T[] {
  return rows.filter((r) => {
    const startsBefore = r.validFrom < to;
    const endsAfter = r.validTo === null || r.validTo > from;
    return startsBefore && endsAfter;
  });
}
