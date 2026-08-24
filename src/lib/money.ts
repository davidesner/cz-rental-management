// Korun ⇄ haléře for the pairing-rule form.
//
// Money is integer haléře everywhere in this app, and a text input asking for
// korun is the one place a user-typed decimal meets it. Both directions are done
// with integer arithmetic on the digit string: `parseFloat` would introduce a
// float on the money path, and — worse — it PARTIALLY parses, so '35 00o' comes
// back as 3500 instead of being rejected.

/** Haléře → an editable korun string, e.g. 3500000 → "35000,00". */
export function toKorunInput(halere: number | null): string {
  if (halere === null) return '';
  const abs = Math.abs(halere);
  return `${halere < 0 ? '-' : ''}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Three outcomes, not two. An EMPTY field legitimately means "cokoliv" (null on
 * the wire); UNPARSEABLE input must not silently collapse into the same null,
 * because the API reads null as "any amount" — so a typo in "Částka od" would
 * quietly widen the rule from a band to every payment in the org.
 */
export type KorunAmount =
  | { kind: 'empty' }
  | { kind: 'value'; halere: number }
  | { kind: 'invalid' };

// Optional sign, at least one digit, then at most two decimal places after
// either separator. Three decimals is rejected rather than rounded: in cs-CZ the
// comma is the DECIMAL separator, so '1,234' is far more likely a mistake than
// an attempt to write 1234.
const KORUN_RE = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/;

export function parseKorun(input: string): KorunAmount {
  const trimmed = input.trim();
  if (trimmed === '') return { kind: 'empty' };
  // Thousands separators come out as spaces in cs-CZ — including NBSP and
  // narrow NBSP, both of which \s already covers.
  const m = KORUN_RE.exec(trimmed.replace(/\s/g, ''));
  if (!m) return { kind: 'invalid' };
  const [, sign, whole, frac] = m;
  const halere = Number(whole) * 100 + Number((frac ?? '').padEnd(2, '0'));
  // Beyond this the digits no longer survive the round trip, so it is not a
  // number we can honestly store as haléře.
  if (!Number.isSafeInteger(halere)) return { kind: 'invalid' };
  return { kind: 'value', halere: sign === '-' ? -halere : halere };
}

/** The wire value: haléře, or null for a field left blank ("cokoliv"). */
export function korunToHalerOrNull(a: KorunAmount): number | null {
  return a.kind === 'value' ? a.halere : null;
}
