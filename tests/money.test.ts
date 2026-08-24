import { describe, it, expect } from 'vitest';
import { korunToHalerOrNull, parseKorun, toKorunInput } from '../src/lib/money.js';

const halere = (s: string) => {
  const r = parseKorun(s);
  return r.kind === 'value' ? r.halere : r.kind;
};

describe('parseKorun', () => {
  it('reads the formatted value toKorunInput produces, thousands separator and all', () => {
    expect(halere('35 000,00')).toBe(3_500_000);
    // toLocaleString('cs-CZ') emits a NON-BREAKING space, not an ordinary one.
    expect(halere('35\u00a0000,00')).toBe(3_500_000);
    expect(halere('35\u202f000,00')).toBe(3_500_000);
  });

  it('is exact on a value a float would not represent', () => {
    // 1234.56 * 100 is 123455.99999999999 in binary floating point.
    expect(halere('1234,56')).toBe(123_456);
  });

  it('accepts a period as the decimal separator too', () => {
    expect(halere('1234.5')).toBe(123_450);
  });

  it('treats a whole number as whole korun', () => {
    expect(halere('35000')).toBe(3_500_000);
    expect(halere('0')).toBe(0);
  });

  it('reports an empty field as empty, which is a legitimate „cokoliv"', () => {
    expect(parseKorun('')).toEqual({ kind: 'empty' });
    expect(parseKorun('   ')).toEqual({ kind: 'empty' });
  });

  // The defect this replaced: parseFloat PARTIALLY parses, so '35 00o' came back
  // as 3500 haléře, and anything it rejected outright came back as null — which
  // the API reads as "any amount", silently widening the rule from a band to
  // every payment in the org.
  it('rejects garbage instead of partially parsing it', () => {
    expect(halere('35 00o')).toBe('invalid');
    expect(halere('35000 Kč')).toBe('invalid');
    expect(halere('abc')).toBe('invalid');
    expect(halere('-')).toBe('invalid');
    expect(halere(',')).toBe('invalid');
    expect(halere(',50')).toBe('invalid');
    expect(halere('1e5')).toBe('invalid');
    expect(halere('1,2,3')).toBe('invalid');
  });

  it('rejects more precision than haléře can hold', () => {
    expect(halere('1,234')).toBe('invalid');
  });

  it('does not silently truncate a number too large to be exact haléře', () => {
    expect(halere('999999999999999999')).toBe('invalid');
  });
});

describe('toKorunInput', () => {
  it('renders haléře as an editable korun string', () => {
    expect(toKorunInput(3_500_000)).toBe('35000,00');
    expect(toKorunInput(123_456)).toBe('1234,56');
    expect(toKorunInput(5)).toBe('0,05');
    expect(toKorunInput(0)).toBe('0,00');
  });

  it('renders an absent bound as an empty field', () => {
    expect(toKorunInput(null)).toBe('');
  });

  it('round-trips every value the form can hold', () => {
    for (const v of [0, 1, 5, 99, 100, 123_456, 3_500_000, 3_850_012]) {
      expect(halere(toKorunInput(v))).toBe(v);
    }
  });
});

describe('korunToHalerOrNull', () => {
  it('sends null for a blank field and the number for a filled one', () => {
    expect(korunToHalerOrNull(parseKorun(''))).toBeNull();
    expect(korunToHalerOrNull(parseKorun('35000'))).toBe(3_500_000);
  });
});
