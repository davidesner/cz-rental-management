import { describe, it, expect } from 'vitest';
import { formatSymbols } from '../src/lib/symbols.js';

describe('formatSymbols', () => {
  it('joins the symbols that are present', () => {
    expect(formatSymbols({ vs: '123', ks: '0308', ss: '456' })).toBe('VS 123 · KS 0308 · SS 456');
  });

  it('omits absent symbols rather than rendering them blank', () => {
    expect(formatSymbols({ vs: '123', ks: null, ss: null })).toBe('VS 123');
    expect(formatSymbols({ vs: null, ks: '0308', ss: null })).toBe('KS 0308');
  });

  it('treats an empty string the same as absent', () => {
    expect(formatSymbols({ vs: '', ks: '0308', ss: '' })).toBe('KS 0308');
  });

  it('returns null when there is nothing to show, so the caller can fall back', () => {
    expect(formatSymbols({ vs: null, ks: null, ss: null })).toBeNull();
  });
});
