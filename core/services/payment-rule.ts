import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { bankIntegration, contract, paymentMatchingRule } from '../db/schema.js';
import { AppError } from '../errors.js';
import { normalizeAccount } from '../lib/account-number.js';
import { validateRuleCriteria } from '../lib/payment-pairing.js';

export interface PaymentRuleRow {
  id: string;
  orgId: string;
  contractId: string;
  counterpartyAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  amountFrom: number | null;
  amountTo: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PairingHealth {
  state: 'nenastaveno' | 'ok' | 'chyba';
  message: string | null;
  lastSyncAt: Date | null;
}

interface HealthIntegration {
  active: boolean;
  lastSyncStatus: 'ok' | 'error' | null;
  lastSyncError: string | null;
  lastSyncAt: Date | null;
}

/**
 * "Stav" on the Párování plateb card: operational health of the pairing, not
 * arrears and not static rule validation.
 *
 * Pure and derived on read — storing it would let it go stale the moment a sync
 * ran.
 *
 * `includeMessage` is the OWNER gate. The integrations queried below are
 * org-wide and unscoped by owner (a failure is not attributable to a property,
 * so allowedPropertyIds cannot express the right answer — the same reasoning
 * documented on requireOwner), and `lastSyncError` is a verbatim operational
 * string: `AUTHENTICATIONFAILED`, or `cannot decrypt IMAP password — check
 * SECRET_ENCRYPTION_KEY (…)`. No credential is echoed, but a property-restricted
 * member has no business reading the org's bank-infrastructure failures.
 *
 * `state` and `lastSyncAt` stay visible to everyone: a member editing the rule
 * must still be able to see THAT pairing is broken, just not why.
 */
export function computePairingHealth(
  rule: { active: boolean } | null,
  integrations: HealthIntegration[],
  opts: { includeMessage: boolean },
): PairingHealth {
  const live = integrations.filter((i) => i.active);
  if (rule === null || !rule.active || live.length === 0) {
    return { state: 'nenastaveno', message: null, lastSyncAt: null };
  }
  // An inactive integration's stale error must not colour the pill — the user
  // switched it off deliberately.
  const failing = live.find((i) => i.lastSyncStatus === 'error');
  if (failing) {
    return {
      state: 'chyba',
      message: opts.includeMessage ? failing.lastSyncError : null,
      lastSyncAt: failing.lastSyncAt,
    };
  }
  const latest = live
    .map((i) => i.lastSyncAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return { state: 'ok', message: null, lastSyncAt: latest };
}

async function assertContract(db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null) {
  const [c] = await db.select().from(contract).where(and(eq(contract.id, contractId), eq(contract.orgId, orgId)));
  if (!c) throw new AppError('not_found', 'pronájem nenalezen');
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(c.propertyId)) {
    throw new AppError('forbidden', 'no access');
  }
  return c;
}

async function loadRule(db: DB, orgId: string, contractId: string): Promise<PaymentRuleRow | null> {
  const [rule] = await db.select().from(paymentMatchingRule)
    .where(and(eq(paymentMatchingRule.orgId, orgId), eq(paymentMatchingRule.contractId, contractId)));
  return (rule as PaymentRuleRow | undefined) ?? null;
}

export async function getPaymentRule(
  db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null,
  // Callers must state the role rather than inherit a default: the health
  // message is org-wide bank-infrastructure detail, and a forgotten argument
  // would silently hand it to a restricted member.
  opts: { isOwner: boolean },
): Promise<{ rule: PaymentRuleRow | null; health: PairingHealth }> {
  await assertContract(db, orgId, contractId, allowedPropertyIds);
  const rule = await loadRule(db, orgId, contractId);
  const integrations = await db.select({
    active: bankIntegration.active,
    lastSyncStatus: bankIntegration.lastSyncStatus,
    lastSyncError: bankIntegration.lastSyncError,
    lastSyncAt: bankIntegration.lastSyncAt,
  }).from(bankIntegration).where(eq(bankIntegration.orgId, orgId));
  return {
    rule,
    health: computePairingHealth(rule, integrations, { includeMessage: opts.isOwner }),
  };
}

export interface PaymentRuleInput {
  counterpartyAccount?: string | null;
  vs?: string | null;
  ks?: string | null;
  ss?: string | null;
  amountFrom?: number | null;
  amountTo?: number | null;
  active?: boolean;
}

/**
 * Normalize blank strings to null before validation. This prevents:
 * - An all-zero symbol (e.g., '000') being silently widened to match any payment
 *   without that criterion (those are still rejected by validateRuleCriteria)
 * - A blank field being stored as an empty string, which then matches nothing
 *   yet looks like a valid criterion
 *
 * A blank field (after trimming) becomes null silently, so the user can leave it
 * empty. An all-zero symbol is NOT blank after trimming and is still rejected.
 */
function blankToNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

export async function upsertPaymentRule(
  db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null, input: PaymentRuleInput,
): Promise<PaymentRuleRow> {
  await assertContract(db, orgId, contractId, allowedPropertyIds);

  // Normalize blank strings to null before validation.
  const account = blankToNull(input.counterpartyAccount);
  const criteria = {
    // Stored CANONICAL, not as typed. Matching semantics do not change —
    // accountsEqual already normalizes both sides — but the prefix is
    // significant (123-294153028/0300 and 294153028/0300 are DIFFERENT
    // accounts) and getting it wrong is the single most likely way to
    // misconfigure pairing. Storing the canonical form means the card and the
    // edit dialog both show the value that will actually be compared, so a
    // user who typed a prefixless account against a prefixed one sees it
    // immediately, on the very next read.
    //
    // Server-side rather than in the browser on purpose: @core/* is in
    // tsconfig.json but NOT in vite.config.ts's aliases, so importing
    // core/lib/account-number.ts from src/ typechecks and then fails
    // `vite build`.
    counterpartyAccount: account === null ? null : normalizeAccount(account),
    vs: blankToNull(input.vs),
    ks: blankToNull(input.ks),
    ss: blankToNull(input.ss),
    amountFrom: input.amountFrom ?? null,
    amountTo: input.amountTo ?? null,
  };

  const problem = validateRuleCriteria(criteria);
  if (problem) throw new AppError('validation', problem);

  const [existing] = await db.select().from(paymentMatchingRule)
    .where(and(eq(paymentMatchingRule.orgId, orgId), eq(paymentMatchingRule.contractId, contractId)));

  if (existing) {
    await db.update(paymentMatchingRule)
      .set({ ...criteria, active: input.active ?? existing.active, updatedAt: new Date() })
      .where(eq(paymentMatchingRule.id, existing.id));
  } else {
    await db.insert(paymentMatchingRule).values({
      id: createId(), orgId, contractId, ...criteria, active: input.active ?? true,
    });
  }
  // loadRule, not getPaymentRule: the caller wants the stored row, and going
  // through getPaymentRule would compute a health object nobody reads — forcing
  // this write path to answer an owner-visibility question it has no stake in.
  return (await loadRule(db, orgId, contractId))!;
}

export async function deletePaymentRule(
  db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null,
): Promise<void> {
  await assertContract(db, orgId, contractId, allowedPropertyIds);
  await db.delete(paymentMatchingRule)
    .where(and(eq(paymentMatchingRule.orgId, orgId), eq(paymentMatchingRule.contractId, contractId)));
}
