import { describe, it, expect } from 'vitest';
import { computeElectricityDefault } from './example-electricity.js';

describe('default electricity compute', () => {
  it('passes through invoice total with no adjustment', () => {
    const out = computeElectricityDefault({ periodFrom: '2024-01-01', periodTo: '2024-12-31', totalCost_haler: 1500000 });
    expect(out.totalAmount_haler).toBe(1500000);
    expect(out.adjustmentAmount_haler).toBe(0);
  });
});
