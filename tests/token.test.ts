import { describe, it, expect } from 'vitest';
import { generateToken, hashToken } from '../core/auth/token.js';

describe('api token', () => {
  it('generates a token and matches its hash', () => {
    const t = generateToken();
    expect(t).toMatch(/^rmt_[a-f0-9]{64}$/);
    const h = hashToken(t);
    expect(h).toHaveLength(64);
    expect(hashToken(t)).toBe(h);
  });

  it('different tokens produce different hashes', () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });
});
