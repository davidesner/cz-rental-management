import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadKey, seal, open } from '../core/lib/crypto-box.js';

const KEY = randomBytes(32);
const KEY_B64 = KEY.toString('base64');

describe('crypto-box', () => {
  it('roundtrips a password', () => {
    const sealed = seal('hunter2-app-password', KEY);
    expect(open(sealed, KEY)).toBe('hunter2-app-password');
  });

  it('roundtrips non-ASCII and empty strings', () => {
    expect(open(seal('přílišžluťoučký', KEY), KEY)).toBe('přílišžluťoučký');
    expect(open(seal('', KEY), KEY)).toBe('');
  });

  it('produces a v1 envelope with four base64url parts', () => {
    const parts = seal('x', KEY).split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    // base64url: no +, /, or = padding
    for (const p of parts.slice(1)) expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('uses a fresh IV per call, so the same plaintext seals differently', () => {
    expect(seal('same', KEY)).not.toBe(seal('same', KEY));
  });

  it('rejects a tampered ciphertext', () => {
    const parts = seal('secret', KEY).split(':');
    // Flip a character in the ciphertext segment
    const ct = parts[3]!;
    parts[3] = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
    expect(() => open(parts.join(':'), KEY)).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const parts = seal('secret', KEY).split(':');
    const tag = parts[2]!;
    parts[2] = (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1);
    expect(() => open(parts.join(':'), KEY)).toThrow();
  });

  it('rejects the wrong key', () => {
    const sealed = seal('secret', KEY);
    expect(() => open(sealed, randomBytes(32))).toThrow();
  });

  it('rejects an unknown envelope version', () => {
    const sealed = seal('secret', KEY).replace(/^v1:/, 'v2:');
    expect(() => open(sealed, KEY)).toThrow(/unsupported ciphertext/);
  });

  it('rejects a malformed envelope', () => {
    expect(() => open('not-an-envelope', KEY)).toThrow(/unsupported ciphertext/);
  });

  describe('loadKey', () => {
    it('accepts 32 base64 bytes', () => {
      expect(loadKey(KEY_B64).length).toBe(32);
    });
    it('rejects undefined', () => {
      expect(() => loadKey(undefined)).toThrow(/not set/);
    });
    it('rejects a key of the wrong length', () => {
      expect(() => loadKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    });
  });
});
