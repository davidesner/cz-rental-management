// Decides which contract an incoming bank transaction belongs to.
//
// One rule per contract (see the spec's decision table). A rule is a conjunction
// of OPTIONAL criteria: every non-null criterion must hold, and a null one means
// "cokoliv". Because a rule with no criteria at all would match every
// transaction in the org, that is rejected at write time by
// validateRuleCriteria rather than tolerated here.
import { accountsEqual } from './account-number.js';

export interface MatchableTransaction {
  amount: number;      // haléře
  valueDate: string;   // YYYY-MM-DD
  fromAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
}

export interface MatchingRule {
  contractId: string;
  counterpartyAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  amountFrom: number | null;
  amountTo: number | null;
  active: boolean;
  // Denormalised from the contract so this stays a pure function. The caller
  // joins them in.
  contractStartDate: string;
  contractEndDate: string | null;
}

export type MatchResult =
  | { kind: 'none' }
  | { kind: 'one'; contractId: string }
  | { kind: 'many'; contractIds: string[] };

/** Bank symbols are numeric strings where leading zeros are not significant. */
export function stripSymbolZeros(s: string | null | undefined): string {
  if (s == null) return '';
  return s.trim().replace(/^0+/, '');
}

function symbolMatches(ruleValue: string | null, txValue: string | null): boolean {
  if (ruleValue === null) return true; // cokoliv
  const wanted = stripSymbolZeros(ruleValue);
  // validateRuleCriteria guarantees `wanted` is non-empty, so an absent symbol
  // on the transaction can never satisfy a rule that specifies one.
  return wanted === stripSymbolZeros(txValue);
}

function contractActiveOn(rule: MatchingRule, date: string): boolean {
  if (date < rule.contractStartDate) return false;
  if (rule.contractEndDate !== null && date > rule.contractEndDate) return false;
  return true;
}

export function ruleMatches(rule: MatchingRule, tx: MatchableTransaction): boolean {
  if (!rule.active) return false;
  // A payment dated outside the lease is not this lease's payment, even if the
  // symbols still line up — this is what stops a stale rule on an ended
  // contract from capturing the next tenant's money.
  if (!contractActiveOn(rule, tx.valueDate)) return false;

  if (rule.counterpartyAccount !== null && !accountsEqual(rule.counterpartyAccount, tx.fromAccount)) return false;
  if (!symbolMatches(rule.vs, tx.vs)) return false;
  if (!symbolMatches(rule.ks, tx.ks)) return false;
  if (!symbolMatches(rule.ss, tx.ss)) return false;
  if (rule.amountFrom !== null && tx.amount < rule.amountFrom) return false;
  if (rule.amountTo !== null && tx.amount > rule.amountTo) return false;

  return true;
}

export function matchTransaction(tx: MatchableTransaction, rules: MatchingRule[]): MatchResult {
  const hits = rules.filter((r) => ruleMatches(r, tx)).map((r) => r.contractId);
  // Deduplicate defensively: the DB has a unique index on contractId, so two
  // rules for one contract shouldn't exist, but reporting 'many' for a single
  // contract would block a payment for no reason.
  const unique = [...new Set(hits)];
  if (unique.length === 0) return { kind: 'none' };
  if (unique.length === 1) return { kind: 'one', contractId: unique[0]! };
  return { kind: 'many', contractIds: unique };
}

type RuleCriteria = Pick<MatchingRule,
  'counterpartyAccount' | 'vs' | 'ks' | 'ss' | 'amountFrom' | 'amountTo'>;

/**
 * Write-time validation. Messages are Czech — they surface directly in the UI.
 * Returns null when the rule is acceptable.
 */
export function validateRuleCriteria(r: RuleCriteria): string | null {
  const symbols: Array<[string, string | null]> = [['Variabilní', r.vs], ['Konstantní', r.ks], ['Specifický', r.ss]];
  for (const [name, value] of symbols) {
    // A symbol of '000' or '   ' strips to empty, which would then match an
    // ABSENT symbol on the transaction and quietly widen the rule.
    if (value !== null && stripSymbolZeros(value) === '') {
      return `${name} symbol nesmí být prázdný ani samé nuly — pro „cokoliv" nech pole nevyplněné`;
    }
  }
  for (const [name, value] of [['Částka od', r.amountFrom], ['Částka do', r.amountTo]] as const) {
    if (value !== null && value < 0) return `${name} nesmí být negativní`;
  }
  if (r.amountFrom !== null && r.amountTo !== null && r.amountFrom > r.amountTo) {
    return 'Částka od nesmí být větší než Částka do';
  }
  const hasAny = r.counterpartyAccount !== null || r.vs !== null || r.ks !== null
    || r.ss !== null || r.amountFrom !== null || r.amountTo !== null;
  if (!hasAny) return 'Pravidlo musí mít alespoň jedno kritérium, jinak by spárovalo každou platbu';
  return null;
}
