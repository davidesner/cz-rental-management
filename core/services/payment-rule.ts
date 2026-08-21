import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { bankIntegration, contract, paymentMatchingRule } from '../db/schema.js';
import { AppError } from '../errors.js';
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
 */
export function computePairingHealth(
  rule: { active: boolean } | null,
  integrations: HealthIntegration[],
): PairingHealth {
  const live = integrations.filter((i) => i.active);
  if (rule === null || !rule.active || live.length === 0) {
    return { state: 'nenastaveno', message: null, lastSyncAt: null };
  }
  // An inactive integration's stale error must not colour the pill — the user
  // switched it off deliberately.
  const failing = live.find((i) => i.lastSyncStatus === 'error');
  if (failing) {
    return { state: 'chyba', message: failing.lastSyncError, lastSyncAt: failing.lastSyncAt };
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

export async function getPaymentRule(
  db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null,
): Promise<{ rule: PaymentRuleRow | null; health: PairingHealth }> {
  await assertContract(db, orgId, contractId, allowedPropertyIds);
  const [rule] = await db.select().from(paymentMatchingRule)
    .where(and(eq(paymentMatchingRule.orgId, orgId), eq(paymentMatchingRule.contractId, contractId)));
  const integrations = await db.select({
    active: bankIntegration.active,
    lastSyncStatus: bankIntegration.lastSyncStatus,
    lastSyncError: bankIntegration.lastSyncError,
    lastSyncAt: bankIntegration.lastSyncAt,
  }).from(bankIntegration).where(eq(bankIntegration.orgId, orgId));
  return {
    rule: (rule as PaymentRuleRow | undefined) ?? null,
    health: computePairingHealth(rule ?? null, integrations),
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
  const criteria = {
    counterpartyAccount: blankToNull(input.counterpartyAccount),
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
  const { rule } = await getPaymentRule(db, orgId, contractId, allowedPropertyIds);
  return rule!;
}

export async function deletePaymentRule(
  db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null,
): Promise<void> {
  await assertContract(db, orgId, contractId, allowedPropertyIds);
  await db.delete(paymentMatchingRule)
    .where(and(eq(paymentMatchingRule.orgId, orgId), eq(paymentMatchingRule.contractId, contractId)));
}
