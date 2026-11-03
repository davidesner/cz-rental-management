// Display formatting. Money arrives as integer haléře and stays that way; only
// the string shown to the user divides by 100.

const CZ_MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const CZ_MONTHS_GEN = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];

/** 1500000 → "15 000 Kč" */
export function fmtKc(halere: number): string {
  return (halere / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 }) + ' Kč';
}

/** With haléře when they are not zero: 1234550 → "12 345,50 Kč" */
export function fmtKcExact(halere: number): string {
  const frac = halere % 100 !== 0;
  return (halere / 100).toLocaleString('cs-CZ', { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 }) + ' Kč';
}

/** "+2 340 Kč" / "−860 Kč" / "0 Kč". Uses the typographic minus. */
export function fmtKcSigned(halere: number): string {
  if (halere > 0) return '+' + fmtKc(halere);
  if (halere < 0) return '−' + fmtKc(-halere);
  return fmtKc(0);
}

/** "2024-02-01" → "1. 2. 2024". Anything that is not an ISO date comes back unchanged. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])}. ${Number(m[2])}. ${m[1]}`;
}

/** "2024-02" or "2024-02-01" → "únor 2024" */
export function fmtMonth(ym: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return ym;
  return `${CZ_MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** "2024-02-01" → "1. února 2024" */
export function fmtDateLong(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])}. ${CZ_MONTHS_GEN[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "2024-02-01" + "2024-12-31" → "1. 2. 2024 až 31. 12. 2024"; an open end reads "dosud". */
export function fmtRange(from: string, to: string | null | undefined, openLabel = 'dosud'): string {
  return `${fmtDate(from)} až ${to ? fmtDate(to) : openLabel}`;
}

/** Czech count with the right plural: dny(1, 2 až 4, 5+). */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  const word = a === 1 ? one : a >= 2 && a <= 4 ? few : many;
  return `${n} ${word}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days from `fromIso` to today (negative when in the future). */
export function daysSince(fromIso: string): number {
  const a = new Date(fromIso + 'T00:00:00');
  const b = new Date(todayIso() + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function initials(name: string | null | undefined, fallback: string): string {
  const src = (name ?? '').trim() || fallback;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[1]?.[0] ?? '' : parts[0]?.[1] ?? '';
  return (first + second).toUpperCase();
}
