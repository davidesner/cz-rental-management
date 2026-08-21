import { createId } from '@paralleldrive/cuid2';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  bankIntegration, bankSyncRun, bankTransaction, contract, payment, paymentMatchingRule,
} from '../db/schema.js';
import { open } from '../lib/crypto-box.js';
import { accountsEqual } from '../lib/account-number.js';
import { parseKbPaymentNotification, type ParsedNotification } from '../lib/kb-email-parser.js';
import { matchTransaction, type MatchingRule } from '../lib/payment-pairing.js';
import type { FetchMessages, ImapConfig, ImapCursor } from '../lib/imap-fetcher.js';

/** Bounded so a run always fits the serverless budget and always makes progress. */
export const MAX_MESSAGES_PER_RUN = 25;

/** Wall-clock allowance for one integration, leaving headroom under maxDuration=60s. */
const DEFAULT_BUDGET_MS = 45_000;

/** How far back a cursor-less run looks. */
const FIRST_RUN_LOOKBACK_DAYS = 90;

export interface SyncDeps {
  fetchMessages: FetchMessages;
  key: Buffer;
  now?: () => Date;
  budgetMs?: number;
}

export interface SyncResult {
  runId: string;
  integrationId: string;
  fetched: number;
  created: number;
  matched: number;
  failed: number;
  status: 'ok' | 'error';
  error: string | null;
}

export interface Fingerprint {
  messageId: string;
  amount: number;
  valueDate: string;
  fromAccount: string | null;
  toAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
}

/**
 * Every rule in the org, with its contract's validity window joined in so the
 * matcher can stay a pure function.
 */
export async function loadCandidateRules(db: DB, orgId: string): Promise<MatchingRule[]> {
  const rows = await db
    .select({
      contractId: paymentMatchingRule.contractId,
      counterpartyAccount: paymentMatchingRule.counterpartyAccount,
      vs: paymentMatchingRule.vs,
      ks: paymentMatchingRule.ks,
      ss: paymentMatchingRule.ss,
      amountFrom: paymentMatchingRule.amountFrom,
      amountTo: paymentMatchingRule.amountTo,
      active: paymentMatchingRule.active,
      contractStartDate: contract.startDate,
      contractEndDate: contract.endDate,
    })
    .from(paymentMatchingRule)
    .innerJoin(contract, eq(contract.id, paymentMatchingRule.contractId))
    .where(and(eq(paymentMatchingRule.orgId, orgId), eq(contract.orgId, orgId)));
  return rows;
}

/**
 * The resend guard. KB gives us no transaction id, so `Message-ID` uniqueness
 * only stops the SAME e-mail being imported twice — not a notification KB
 * re-sends for money already collected. Look for an earlier transaction with an
 * identical fingerprint that actually produced a payment.
 */
export async function findDuplicate(db: DB, orgId: string, fp: Fingerprint): Promise<string | null> {
  const conds = [
    eq(bankTransaction.orgId, orgId),
    ne(bankTransaction.messageId, fp.messageId),
    // Only a transaction that produced a payment can be double-counted.
    isNotNull(bankTransaction.paymentId),
    eq(bankTransaction.amount, fp.amount),
    eq(bankTransaction.valueDate, fp.valueDate),
  ];
  const candidates = await db.select({
    id: bankTransaction.id,
    fromAccount: bankTransaction.fromAccount,
    toAccount: bankTransaction.toAccount,
    vs: bankTransaction.vs,
    ks: bankTransaction.ks,
    ss: bankTransaction.ss,
  }).from(bankTransaction).where(and(...conds));

  // Amount + date narrow it in SQL; the nullable text columns are compared here
  // so NULL === NULL counts as equal, which SQL's `=` would not.
  const same = candidates.find((r) =>
    r.fromAccount === fp.fromAccount
    && r.toAccount === fp.toAccount
    && r.vs === fp.vs && r.ks === fp.ks && r.ss === fp.ss);
  return same?.id ?? null;
}

interface Outcome {
  status: 'matched' | 'unmatched' | 'ambiguous' | 'suspected_duplicate' | 'ignored';
  statusReason: string | null;
  contractId: string | null;
  duplicateOf: string | null;
}

async function decide(
  db: DB, orgId: string, integrationAccount: string | null,
  parsed: ParsedNotification, rules: MatchingRule[],
): Promise<Outcome> {
  const none = { contractId: null, duplicateOf: null };

  // Policy, deliberately here rather than in the parser: a EUR notification
  // parses perfectly, we just do not act on it.
  if (parsed.currency !== 'CZK') {
    return { status: 'ignored', statusReason: 'unsupported_currency', ...none };
  }
  // Guards against harvesting notifications for another of the user's accounts
  // that happens to share the mailbox.
  if (integrationAccount !== null && !accountsEqual(integrationAccount, parsed.toAccount)) {
    return { status: 'ignored', statusReason: 'foreign_account', ...none };
  }

  const match = matchTransaction(
    {
      amount: parsed.amount, valueDate: parsed.valueDate, fromAccount: parsed.fromAccount,
      vs: parsed.vs, ks: parsed.ks, ss: parsed.ss,
    },
    rules,
  );
  if (match.kind === 'none') return { status: 'unmatched', statusReason: null, ...none };
  if (match.kind === 'many') {
    return { status: 'ambiguous', statusReason: `candidates: ${match.contractIds.join(', ')}`, ...none };
  }

  const duplicateOf = await findDuplicate(db, orgId, {
    messageId: parsed.messageId, amount: parsed.amount, valueDate: parsed.valueDate,
    fromAccount: parsed.fromAccount, toAccount: parsed.toAccount,
    vs: parsed.vs, ks: parsed.ks, ss: parsed.ss,
  });
  if (duplicateOf !== null) {
    // Held, not discarded: two genuinely identical transfers on one day are
    // possible, and dropping one would silently lose a tenant's money. The user
    // confirms it from the inbox, which creates the payment as a manual assign.
    return { status: 'suspected_duplicate', statusReason: 'shodná platba už je spárovaná', contractId: null, duplicateOf };
  }
  return { status: 'matched', statusReason: null, contractId: match.contractId, duplicateOf: null };
}

/**
 * Structural parameter rather than ParsedNotification: the manual-assign path in
 * bank-transaction.ts calls this with a DB row, which has these four fields but
 * not the rest. Casting a partial object at that call site would be a real type
 * hazard for no benefit.
 */
export interface DescribableTransaction {
  messageForRecipient: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
}

export function buildDescription(tx: DescribableTransaction): string | null {
  if (tx.messageForRecipient) return tx.messageForRecipient;
  const parts = [
    tx.vs ? `VS ${tx.vs}` : null,
    tx.ks ? `KS ${tx.ks}` : null,
    tx.ss ? `SS ${tx.ss}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export async function syncIntegration(
  db: DB, integrationId: string, deps: SyncDeps, trigger: 'cron' | 'manual',
): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const runId = createId();
  const [integ] = await db.select().from(bankIntegration).where(eq(bankIntegration.id, integrationId));
  if (!integ) throw new Error(`bank integration ${integrationId} not found`);

  await db.insert(bankSyncRun).values({ id: runId, integrationId, trigger, status: 'ok', startedAt: now() });

  let fetched = 0, created = 0, matched = 0, failed = 0;
  let error: string | null = null;

  try {
    // A bad key must fail the run with a distinct, recognisable message rather
    // than surface as a mysterious auth error against the mail server.
    let password: string;
    try {
      password = open(integ.imapPasswordEnc, deps.key);
    } catch (e) {
      throw new Error(`cannot decrypt IMAP password — check BANK_SECRET_KEY (${e instanceof Error ? e.message : String(e)})`);
    }

    const cfg: ImapConfig = {
      host: integ.imapHost, port: integ.imapPort, user: integ.imapUser,
      password, folder: integ.imapFolder,
    };
    const cursor: ImapCursor = { uidValidity: integ.uidValidity, lastUid: integ.lastUid };
    const lookback = new Date(now().getTime() - FIRST_RUN_LOOKBACK_DAYS * 86_400_000);

    const { messages, cursor: nextCursor } = await deps.fetchMessages(cfg, cursor, {
      limit: MAX_MESSAGES_PER_RUN,
      sinceFallback: integ.lastSyncAt ?? lookback,
      deadline: now().getTime() + (deps.budgetMs ?? DEFAULT_BUDGET_MS),
    });
    fetched = messages.length;

    const rules = await loadCandidateRules(db, integ.orgId);

    for (const msg of messages) {
      const parseResult = await parseKbPaymentNotification(msg.source, {
        fromFilter: integ.fromFilter, subjectFilter: integ.subjectFilter,
      });

      if (!parseResult.ok) {
        // A stray newsletter is not a failure — storing it would fill the inbox
        // with noise, and escalating the integration to `error` over it would
        // cry wolf. Anything else IS a failure worth seeing.
        if (parseResult.reason === 'not_kb_notification') continue;

        failed += 1;
        error = `${parseResult.reason}: ${parseResult.detail}`;
        if (parseResult.messageId) {
          await db.insert(bankTransaction).values({
            id: createId(), orgId: integ.orgId, integrationId,
            messageId: parseResult.messageId,
            amount: 0, currency: 'CZK', valueDate: (parseResult.receivedAt ?? now()).toISOString().slice(0, 10),
            status: 'parse_failed', statusReason: `${parseResult.reason}: ${parseResult.detail}`,
            rawTokens: parseResult.tokens,
            receivedAt: parseResult.receivedAt ?? now(),
          }).onConflictDoNothing();
          created += 1;
        }
        continue;
      }

      const parsed = parseResult.value;
      const existing = await db.select({ id: bankTransaction.id }).from(bankTransaction)
        .where(and(eq(bankTransaction.orgId, integ.orgId), eq(bankTransaction.messageId, parsed.messageId)));
      if (existing.length > 0) continue; // already imported

      const outcome = await decide(db, integ.orgId, integ.accountNumber, parsed, rules);

      // One transaction per message: the staging row and its payment are
      // created together or not at all.
      let insertedPaymentId: string | null = null;
      await db.transaction(async (tx) => {
        let paymentId: string | null = null;
        if (outcome.status === 'matched' && outcome.contractId) {
          paymentId = createId();
          await tx.insert(payment).values({
            id: paymentId, orgId: integ.orgId, contractId: outcome.contractId,
            amount: parsed.amount, paidAt: parsed.valueDate,
            counterparty: null,                       // KB sends no payer name
            counterpartyAccount: parsed.fromAccount,
            externalId: `kbemail:${parsed.messageId}`, // second idempotency guard
            statementRef: parsed.sourceLink,
            source: 'bank',
            description: buildDescription(parsed),
          });
        }
        await tx.insert(bankTransaction).values({
          id: createId(), orgId: integ.orgId, integrationId,
          messageId: parsed.messageId,
          amount: parsed.amount, currency: parsed.currency, valueDate: parsed.valueDate,
          fromAccount: parsed.fromAccount, toAccount: parsed.toAccount,
          vs: parsed.vs, ks: parsed.ks, ss: parsed.ss,
          messageForRecipient: parsed.messageForRecipient,
          sourceLink: parsed.sourceLink, rawTokens: parsed.tokens,
          status: outcome.status, statusReason: outcome.statusReason,
          duplicateOfTransactionId: outcome.duplicateOf,
          matchedBy: paymentId ? 'rule' : null,
          paymentId,
          receivedAt: parsed.receivedAt,
        });
        insertedPaymentId = paymentId;
      });
      // Counters advance only after the transaction COMMITS. Incrementing inside
      // the callback would leave them overstated if it rolled back, and the
      // counters are what the UI and the run log report.
      created += 1;
      if (insertedPaymentId) matched += 1;
    }

    // The cursor advances even when a message failed to parse — otherwise one
    // malformed e-mail wedges the integration forever. The parse_failed row is
    // what keeps it from being lost.
    await db.update(bankIntegration).set({
      uidValidity: nextCursor.uidValidity,
      lastUid: nextCursor.lastUid,
      lastSyncAt: now(),
      lastSyncStatus: failed > 0 ? 'error' : 'ok',
      lastSyncError: failed > 0 ? error : null,
    }).where(eq(bankIntegration.id, integrationId));

    await db.update(bankSyncRun).set({
      finishedAt: now(), status: failed > 0 ? 'error' : 'ok',
      fetched, created, matched, failed, error,
    }).where(eq(bankSyncRun.id, runId));

    return { runId, integrationId, fetched, created, matched, failed, status: failed > 0 ? 'error' : 'ok', error };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(bankIntegration).set({
      lastSyncAt: now(), lastSyncStatus: 'error', lastSyncError: message,
    }).where(eq(bankIntegration.id, integrationId));
    await db.update(bankSyncRun).set({
      finishedAt: now(), status: 'error', fetched, created, matched, failed, error: message,
    }).where(eq(bankSyncRun.id, runId));
    return { runId, integrationId, fetched, created, matched, failed, status: 'error', error: message };
  }
}

/**
 * Every active integration across ALL orgs — the cron path.
 *
 * One integration's failure must not stop the rest, so syncIntegration's own
 * error handling is relied on and results are collected rather than thrown.
 */
export async function syncAllActiveIntegrations(db: DB, deps: SyncDeps): Promise<SyncResult[]> {
  const rows = await db.select({ id: bankIntegration.id }).from(bankIntegration)
    .where(eq(bankIntegration.active, true));
  const results: SyncResult[] = [];
  for (const row of rows) {
    results.push(await syncIntegration(db, row.id, deps, 'cron'));
  }
  return results;
}
