import { describe, it, expect } from 'vitest';
import { validAt, openRow, overlapping } from '../core/lib/temporal.js';

// ---------------------------------------------------------------------------
// validAt – edge cases
// ---------------------------------------------------------------------------
describe('validAt edge cases', () => {
  const rows = [
    { validFrom: '2024-01-01', validTo: '2024-06-01', tag: 'A' },
    { validFrom: '2024-06-01', validTo: '2025-01-01', tag: 'B' },
    { validFrom: '2025-01-01', validTo: null,          tag: 'C' },
  ];

  it('date exactly equals validFrom — row matches (inclusive lower bound)', () => {
    // '2024-06-01' is the validFrom of row B; it should match B, not A
    expect(validAt(rows, '2024-06-01')?.tag).toBe('B');
  });

  it('date exactly equals validTo — row does NOT match (exclusive upper bound)', () => {
    // Row A has validTo='2024-06-01'; a date of '2024-06-01' must NOT return A
    const result = validAt(rows, '2024-06-01');
    expect(result?.tag).not.toBe('A');
  });

  it('open-ended row (validTo=null) matches any date >= validFrom', () => {
    expect(validAt(rows, '2025-01-01')?.tag).toBe('C');
    expect(validAt(rows, '2099-12-31')?.tag).toBe('C');
  });

  it('date before any row — returns null', () => {
    expect(validAt(rows, '2023-12-31')).toBeNull();
  });

  it('empty array — returns null', () => {
    expect(validAt([], '2024-06-01')).toBeNull();
  });

  it('multiple overlapping rows — first match in array order wins', () => {
    // Two rows that both cover the same date; validAt returns the first one encountered
    const overlappingRows = [
      { validFrom: '2024-01-01', validTo: null, tag: 'X' },
      { validFrom: '2024-01-01', validTo: null, tag: 'Y' },
    ];
    expect(validAt(overlappingRows, '2024-06-01')?.tag).toBe('X');
  });
});

// ---------------------------------------------------------------------------
// openRow – edge cases
// ---------------------------------------------------------------------------
describe('openRow edge cases', () => {
  it('no open row — returns null', () => {
    const rows = [
      { validFrom: '2024-01-01', validTo: '2024-06-01' },
      { validFrom: '2024-06-01', validTo: '2025-01-01' },
    ];
    expect(openRow(rows)).toBeNull();
  });

  it('exactly one open row — returns it', () => {
    const rows = [
      { validFrom: '2024-01-01', validTo: '2024-06-01', tag: 'A' },
      { validFrom: '2024-06-01', validTo: null,          tag: 'B' },
    ];
    expect(openRow(rows)?.tag).toBe('B');
  });

  it('multiple open rows — returns the first one encountered', () => {
    // Unusual but we document the behavior: first open row in array order
    const rows = [
      { validFrom: '2024-01-01', validTo: null, tag: 'First' },
      { validFrom: '2024-06-01', validTo: null, tag: 'Second' },
    ];
    expect(openRow(rows)?.tag).toBe('First');
  });

  it('empty array — returns null', () => {
    expect(openRow([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// overlapping – edge cases
// ---------------------------------------------------------------------------
describe('overlapping edge cases', () => {
  const rows = [
    { validFrom: '2024-01-01', validTo: '2024-06-01', tag: 'A' },
    { validFrom: '2024-06-01', validTo: '2025-01-01', tag: 'B' },
    { validFrom: '2025-01-01', validTo: null,          tag: 'C' },
  ];

  it('range entirely before any row — returns empty array', () => {
    const result = overlapping(rows, '2020-01-01', '2023-12-31');
    expect(result).toEqual([]);
  });

  it('range entirely after all closed rows — returns only open-ended row', () => {
    const closedRows = [
      { validFrom: '2024-01-01', validTo: '2024-06-01', tag: 'A' },
      { validFrom: '2024-06-01', validTo: '2025-01-01', tag: 'B' },
    ];
    const result = overlapping(closedRows, '2026-01-01', '2027-01-01');
    expect(result).toEqual([]);
  });

  it('range fully inside a single row — returns only that row', () => {
    const result = overlapping(rows, '2024-02-01', '2024-04-01').map((r) => r.tag);
    expect(result).toEqual(['A']);
  });

  it('range spanning multiple rows — returns all overlapping rows', () => {
    const result = overlapping(rows, '2024-05-01', '2025-06-01').map((r) => r.tag);
    expect(result).toEqual(['A', 'B', 'C']);
  });

  it('range touching boundary from == row.validTo — does NOT include that row', () => {
    // Row A has validTo='2024-06-01'; querying from='2024-06-01' should not include A
    // because the filter requires r.validTo > from (strictly greater)
    const result = overlapping(rows, '2024-06-01', '2024-09-01').map((r) => r.tag);
    expect(result).not.toContain('A');
    expect(result).toContain('B');
  });

  it('range touching boundary to == row.validFrom — does NOT include that row', () => {
    // Row B has validFrom='2024-06-01'; querying to='2024-06-01' should not include B
    // because the filter requires r.validFrom < to (strictly less)
    const result = overlapping(rows, '2024-01-01', '2024-06-01').map((r) => r.tag);
    expect(result).toContain('A');
    expect(result).not.toContain('B');
  });

  it('open-ended row overlaps any query range that starts before its validTo (infinity)', () => {
    // Row C has validFrom='2025-01-01' and validTo=null; any range where to > '2025-01-01' overlaps
    const result = overlapping(rows, '2030-01-01', '2035-01-01').map((r) => r.tag);
    expect(result).toContain('C');
  });

  it('open-ended row does NOT overlap a range that ends at or before validFrom', () => {
    // Row C has validFrom='2025-01-01'; querying to='2025-01-01' means to is NOT > validFrom
    const onlyOpenRow = [{ validFrom: '2025-01-01', validTo: null, tag: 'C' }];
    const result = overlapping(onlyOpenRow, '2020-01-01', '2025-01-01').map((r) => r.tag);
    // '2025-01-01' < '2025-01-01' is false → row NOT included
    expect(result).not.toContain('C');
  });
});
