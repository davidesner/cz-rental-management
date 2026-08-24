import { describe, it, expect } from 'vitest';
import {
  ruleMatches, matchTransaction, validateRuleCriteria, stripSymbolZeros,
  type MatchingRule, type MatchableTransaction,
} from '../core/lib/payment-pairing.js';

const TX: MatchableTransaction = {
  amount: 3_800_000,               // 38 000,00 Kč
  valueDate: '2026-08-20',
  fromAccount: '294153028/0300',
  vs: '2026008',
  ks: '0308',
  ss: '77',
};

// A rule that matches TX on every criterion; tests narrow from here.
const RULE: MatchingRule = {
  contractId: 'c1',
  counterpartyAccount: '294153028/0300',
  vs: '2026008',
  ks: '0308',
  ss: '77',
  amountFrom: 3_500_000,
  amountTo: 4_120_000,
  active: true,
  contractStartDate: '2024-09-01',
  contractEndDate: null,
};

const rule = (o: Partial<MatchingRule> = {}): MatchingRule => ({ ...RULE, ...o });
const tx = (o: Partial<MatchableTransaction> = {}): MatchableTransaction => ({ ...TX, ...o });

describe('payment-pairing', () => {
  describe('ruleMatches', () => {
    it('matches when every criterion holds', () => {
      expect(ruleMatches(rule(), tx())).toBe(true);
    });

    it('treats a null criterion as cokoliv', () => {
      const wide = rule({ counterpartyAccount: null, vs: null, ks: null, ss: null });
      expect(ruleMatches(wide, tx({ fromAccount: '999/0800', vs: null, ks: null, ss: null }))).toBe(true);
    });

    it('requires the account to match when set', () => {
      expect(ruleMatches(rule(), tx({ fromAccount: '111222333/0800' }))).toBe(false);
      expect(ruleMatches(rule(), tx({ fromAccount: null }))).toBe(false);
    });

    it('ignores leading zeros in symbols', () => {
      expect(ruleMatches(rule({ vs: '0002026008' }), tx({ vs: '2026008' }))).toBe(true);
      expect(ruleMatches(rule({ ks: '308' }), tx({ ks: '0308' }))).toBe(true);
    });

    it('requires a symbol to be present on the transaction when the rule sets it', () => {
      expect(ruleMatches(rule(), tx({ vs: null }))).toBe(false);
    });

    it('applies amount bounds inclusively', () => {
      expect(ruleMatches(rule(), tx({ amount: 3_500_000 }))).toBe(true);
      expect(ruleMatches(rule(), tx({ amount: 4_120_000 }))).toBe(true);
      expect(ruleMatches(rule(), tx({ amount: 3_499_999 }))).toBe(false);
      expect(ruleMatches(rule(), tx({ amount: 4_120_001 }))).toBe(false);
    });

    it('supports a one-sided amount bound', () => {
      expect(ruleMatches(rule({ amountFrom: 3_500_000, amountTo: null }), tx({ amount: 9_000_000 }))).toBe(true);
      expect(ruleMatches(rule({ amountFrom: null, amountTo: 4_120_000 }), tx({ amount: 1 }))).toBe(true);
    });

    it('never matches an inactive rule', () => {
      expect(ruleMatches(rule({ active: false }), tx())).toBe(false);
    });

    // Stops an ended lease's stale rule from stealing the next tenant's payment.
    it('requires the contract to be active on the value date', () => {
      expect(ruleMatches(rule({ contractStartDate: '2026-09-01' }), tx())).toBe(false);
      expect(ruleMatches(rule({ contractEndDate: '2026-07-31' }), tx())).toBe(false);
      expect(ruleMatches(rule({ contractEndDate: '2026-08-20' }), tx())).toBe(true); // inclusive
      expect(ruleMatches(rule({ contractStartDate: '2026-08-20' }), tx())).toBe(true); // inclusive
    });
  });

  describe('matchTransaction', () => {
    it('reports none when nothing matches', () => {
      expect(matchTransaction(tx(), [rule({ vs: '999' })])).toEqual({ kind: 'none' });
      expect(matchTransaction(tx(), [])).toEqual({ kind: 'none' });
    });

    it('reports the single matching contract', () => {
      expect(matchTransaction(tx(), [rule({ contractId: 'c1' }), rule({ contractId: 'c2', vs: '999' })]))
        .toEqual({ kind: 'one', contractId: 'c1' });
    });

    it('reports ambiguity rather than guessing', () => {
      const res = matchTransaction(tx(), [rule({ contractId: 'c1' }), rule({ contractId: 'c2' })]);
      expect(res.kind).toBe('many');
      if (res.kind !== 'many') return;
      expect(res.contractIds.sort()).toEqual(['c1', 'c2']);
    });
  });

  describe('validateRuleCriteria', () => {
    const base = { counterpartyAccount: null, vs: null, ks: null, ss: null, amountFrom: null, amountTo: null };

    it('rejects a rule with no criteria — it would match every transaction', () => {
      expect(validateRuleCriteria(base)).toMatch(/alespoň jedno kritérium/);
    });

    it('accepts a single IDENTIFYING criterion', () => {
      expect(validateRuleCriteria({ ...base, vs: '2026008' })).toBeNull();
      expect(validateRuleCriteria({ ...base, ks: '0308' })).toBeNull();
      expect(validateRuleCriteria({ ...base, ss: '77' })).toBeNull();
      expect(validateRuleCriteria({ ...base, counterpartyAccount: '294153028/0300' })).toBeNull();
    });

    it('accepts an amount range closed on both sides', () => {
      expect(validateRuleCriteria({ ...base, amountFrom: 100, amountTo: 500 })).toBeNull();
    });

    // The match-everything hole: `hasAny` was satisfied by any non-null amount
    // bound and only NEGATIVE amounts were rejected, so an amount half-band was
    // accepted and then matched anything at all. Reachable by a
    // property-restricted member, whose rule then both harvests unmatched org
    // payments and pushes every other contract's payments to `ambiguous`.
    it('rejects an amount-only rule whose band is open on one side', () => {
      expect(validateRuleCriteria({ ...base, amountFrom: 0 })).toMatch(/alespoň jedno kritérium/);
      expect(validateRuleCriteria({ ...base, amountFrom: 100 })).toMatch(/alespoň jedno kritérium/);
      expect(validateRuleCriteria({ ...base, amountTo: 100 })).toMatch(/alespoň jedno kritérium/);
    });

    // Replicates the accepted-today case end to end: validation let it through,
    // and then it matched.
    it('would have matched an unrelated transaction — which is why it is refused', () => {
      const wide = { counterpartyAccount: null, vs: null, ks: null, ss: null, amountFrom: 0, amountTo: null };
      expect(validateRuleCriteria(wide)).not.toBeNull();
      // Proof the refusal is load-bearing rather than cosmetic.
      expect(ruleMatches(rule(wide), tx({ amount: 999_999_999, fromAccount: '111222333/0800', vs: null, ks: null, ss: null }))).toBe(true);
    });

    it('rejects an inverted amount band', () => {
      expect(validateRuleCriteria({ ...base, amountFrom: 500, amountTo: 100 })).toMatch(/Částka od/);
    });

    it('rejects a symbol that is only zeros, which would strip to empty', () => {
      expect(validateRuleCriteria({ ...base, vs: '000' })).toMatch(/symbol/);
      expect(validateRuleCriteria({ ...base, vs: '   ' })).toMatch(/symbol/);
    });

    it('rejects a negative amount bound', () => {
      expect(validateRuleCriteria({ ...base, amountFrom: -1 })).toMatch(/nesmí být negativní/);
    });
  });

  describe('stripSymbolZeros', () => {
    it('normalizes for comparison', () => {
      expect(stripSymbolZeros('0123')).toBe('123');
      expect(stripSymbolZeros(' 123 ')).toBe('123');
      expect(stripSymbolZeros(null)).toBe('');
      expect(stripSymbolZeros('000')).toBe('');
    });
  });
});
