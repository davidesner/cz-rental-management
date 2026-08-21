import { describe, it, expect } from 'vitest';
import { parseAccount, normalizeAccount, accountsEqual } from '../core/lib/account-number.js';

describe('account-number', () => {
  describe('parseAccount', () => {
    it('splits a prefixed account', () => {
      expect(parseAccount('123-1234567890/0100'))
        .toEqual({ prefix: '123', number: '1234567890', bankCode: '0100' });
    });

    it('splits a prefixless account', () => {
      expect(parseAccount('294153028/0300'))
        .toEqual({ prefix: null, number: '294153028', bankCode: '0300' });
    });

    it('tolerates whitespace around the separators', () => {
      expect(parseAccount('  123 - 1234567890 / 0100  '))
        .toEqual({ prefix: '123', number: '1234567890', bankCode: '0100' });
    });

    it('returns null for junk', () => {
      expect(parseAccount('')).toBeNull();
      expect(parseAccount('not an account')).toBeNull();
      expect(parseAccount('123456/12')).toBeNull();       // bank code must be 4 digits
      expect(parseAccount('12345678901/0100')).toBeNull(); // number caps at 10 digits
    });
  });

  describe('normalizeAccount', () => {
    it('leaves a canonical account untouched', () => {
      expect(normalizeAccount('123-1234567890/0100')).toBe('123-1234567890/0100');
      expect(normalizeAccount('294153028/0300')).toBe('294153028/0300');
    });

    it('strips leading zeros from prefix and number', () => {
      expect(normalizeAccount('000123-0001234567/0100')).toBe('123-1234567/0100');
    });

    it('treats an all-zero prefix as absent — same account, two spellings', () => {
      expect(normalizeAccount('000-294153028/0300')).toBe('294153028/0300');
      expect(normalizeAccount('0-294153028/0300')).toBe('294153028/0300');
    });

    it('keeps the bank code at four digits, zeros included', () => {
      expect(normalizeAccount('294153028/0300')).toBe('294153028/0300');
      expect(normalizeAccount('294153028/0100')).toBe('294153028/0100');
    });

    it('returns unparseable input trimmed and verbatim', () => {
      expect(normalizeAccount('  CZ6508000000192000145399  ')).toBe('CZ6508000000192000145399');
    });
  });

  describe('accountsEqual', () => {
    it('matches across cosmetic differences', () => {
      expect(accountsEqual('000123-0001234567/0100', '123-1234567/0100')).toBe(true);
      expect(accountsEqual(' 294153028 / 0300 ', '294153028/0300')).toBe(true);
      expect(accountsEqual('000-294153028/0300', '294153028/0300')).toBe(true);
    });

    // THE LOAD-BEARING NEGATIVE. A rule entered without a prefix must not
    // match a transaction that has one — they are different accounts, and
    // silently collapsing them would pair a payment to the wrong contract.
    it('treats a prefixed and a prefixless account as different', () => {
      expect(accountsEqual('123-294153028/0300', '294153028/0300')).toBe(false);
    });

    it('does not match on bank code alone', () => {
      expect(accountsEqual('294153028/0300', '294153028/0100')).toBe(false);
    });

    it('is false when either side is missing', () => {
      expect(accountsEqual(null, '294153028/0300')).toBe(false);
      expect(accountsEqual('294153028/0300', undefined)).toBe(false);
      expect(accountsEqual(null, null)).toBe(false);
    });

    it('matches unparseable input only against itself verbatim', () => {
      expect(accountsEqual('CZ65 0800 0000 1920 0014 5399', 'CZ65 0800 0000 1920 0014 5399')).toBe(true);
      expect(accountsEqual('CZ6508000000192000145399', 'CZ65 0800 0000 1920 0014 5399')).toBe(false);
    });
  });
});
