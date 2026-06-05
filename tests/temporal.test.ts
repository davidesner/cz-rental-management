import { describe, it, expect } from 'vitest';
import { validAt, openRow, overlapping } from '../core/lib/temporal.js';

const rows = [
  { validFrom: '2024-01-01', validTo: '2024-06-01', tag: 'A' },
  { validFrom: '2024-06-01', validTo: '2025-01-01', tag: 'B' },
  { validFrom: '2025-01-01', validTo: null,        tag: 'C' },
];

describe('validAt', () => {
  it('picks the right row in each window', () => {
    expect(validAt(rows, '2024-03-15')?.tag).toBe('A');
    expect(validAt(rows, '2024-06-01')?.tag).toBe('B');
    expect(validAt(rows, '2024-12-31')?.tag).toBe('B');
    expect(validAt(rows, '2025-01-01')?.tag).toBe('C');
    expect(validAt(rows, '2030-01-01')?.tag).toBe('C');
  });
  it('returns null for dates before any row', () => {
    expect(validAt(rows, '2023-12-31')).toBeNull();
  });
});

describe('openRow', () => {
  it('finds the open-ended row', () => {
    expect(openRow(rows)?.tag).toBe('C');
  });
});

describe('overlapping', () => {
  it('returns rows that intersect the range', () => {
    expect(overlapping(rows, '2024-05-01', '2024-07-01').map((r) => r.tag)).toEqual(['A', 'B']);
    expect(overlapping(rows, '2024-09-20', '2024-12-31').map((r) => r.tag)).toEqual(['B']);
    expect(overlapping(rows, '2024-12-31', '2025-06-30').map((r) => r.tag)).toEqual(['B', 'C']);
  });
});
