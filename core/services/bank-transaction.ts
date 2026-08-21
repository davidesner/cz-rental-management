import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { bankTransaction, contract, payment, property, tenant } from '../db/schema.js';
import { AppError } from '../errors.js';
import { parseFromTokens } from '../lib/kb-email-parser.js';
import { buildDescription } from './bank-sync.js';
import { recordPayment } from './payment.js';

export interface BankTransactionRow {
  id: string;
  orgId: string;
  integrationId: string;
  messageId: string;
  amount: number;
  currency: string;
  valueDate: string;
  fromAccount: string | null;
  toAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  messageForRecipient: string | null;
  sourceLink: string | null;
  status: string;
  statusReason: string | null;
  duplicateOfTransactionId: string | null;
  matchedBy: 'rule' | 'manual' | null;
  paymentId: string | null;
  receivedAt: Date;
  createdAt: Date;
  contractId: string | null;
  propertyName: string | null;
  tenantName: string | null;
}

const selectShape = {
  id: bankTransaction.id,
  orgId: bankTransaction.orgId,
  integrationId: bankTransaction.integrationId,
  messageId: bankTransaction.messageId,
  amount: bankTransaction.amount,
  currency: bankTransaction.currency,
  valueDate: bankTransaction.valueDate,
  fromAccount: bankTransaction.fromAccount,
  toAccount: bankTransaction.toAccount,
  vs: bankTransaction.vs,
  ks: bankTransaction.ks,
  ss: bankTransaction.ss,
  messageForRecipient: bankTransaction.messageForRecipient,
  sourceLink: bankTransaction.sourceLink,
  status: bankTransaction.status,
  statusReason: bankTransaction.statusReason,
  duplicateOfTransactionId: bankTransaction.duplicateOfTransactionId,
  matchedBy: bankTransaction.matchedBy,
  paymentId: bankTransaction.paymentId,
  receivedAt: bankTransaction.receivedAt,
  createdAt: bankTransaction.createdAt,
  contractId: payment.contractId,
  propertyName: property.name,
  tenantName: tenant.name,
} as const;

function baseQuery(db: DB) {
  return db.select(selectShape).from(bankTransaction)
    .leftJoin(payment, eq(payment.id, bankTransaction.paymentId))
    .leftJoin(contract, and(eq(contract.id, payment.contractId), eq(contract.orgId, bankTransaction.orgId)))
    .leftJoin(property, eq(property.id, contract.propertyId))
    .leftJoin(tenant, eq(tenant.id, contract.tenantId));
}

export async function listBankTransactions(
  db: DB, orgId: string, filters: { status?: string; pendingOnly?: boolean } = {},
): Promise<BankTransactionRow[]> {
  const conds = [eq(bankTransaction.orgId, orgId)];
  if (filters.status) conds.push(eq(bankTransaction.status, filters.status as 'unmatched'));
  if (filters.pendingOnly) {
    // `paymentId IS NULL` is the source of truth for "needs attention": if the
    // user deletes a created payment the FK nulls out, and no trigger can
    // rewrite `status`, so status is advisory metadata only.
    conds.push(isNull(bankTransaction.paymentId));
    conds.push(ne(bankTransaction.status, 'ignored'));
  }
  return baseQuery(db).where(and(...conds)).orderBy(desc(bankTransaction.valueDate)) as Promise<BankTransactionRow[]>;
}

async function getRaw(db: DB, orgId: string, id: string) {
  const [row] = await db.select().from(bankTransaction)
    .where(and(eq(bankTransaction.id, id), eq(bankTransaction.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'bankovní transakce nenalezena');
  return row;
}

export async function getBankTransaction(db: DB, orgId: string, id: string): Promise<BankTransactionRow> {
  const [row] = await baseQuery(db).where(and(eq(bankTransaction.id, id), eq(bankTransaction.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'bankovní transakce nenalezena');
  return row as BankTransactionRow;
}

/**
 * Create the payment for a transaction and link it.
 *
 * Also the confirmation path for a suspected duplicate — "Není duplikát —
 * spárovat" is just a manual assignment, so it needs no separate endpoint. That
 * is what `confirmDuplicate` is for: duplicate detection lives in
 * recordPayment now, and without an explicit override it would refuse the very
 * click whose entire purpose is to say "I looked, it is a separate transfer".
 * A careless assign still gets caught, because the override has to be asked for.
 *
 * The write goes THROUGH recordPayment rather than inserting directly, so there
 * is one write path and one duplicate guard that cannot drift apart. It costs a
 * couple of extra queries inside the transaction (the contract re-check and the
 * joined re-fetch) and gains recordPayment's externalId idempotency: a replayed
 * assign now links the existing payment instead of hitting the unique index.
 */
export async function assignBankTransaction(
  db: DB, orgId: string, id: string, contractId: string, confirmDuplicate = false,
): Promise<BankTransactionRow> {
  const row = await getRaw(db, orgId, id);
  if (row.paymentId !== null) throw new AppError('conflict', 'transakce už je spárovaná s platbou');
  if (row.status === 'parse_failed') throw new AppError('bad_request', 'nelze spárovat transakci, kterou se nepodařilo zpracovat');
  // payment.amount is CZK haléře, full stop. row.amount for a EUR notification
  // holds euro CENTS, so assigning it would turn €40,00 into 40,00 Kč silently.
  // Reachable in two MCP calls: bank_transactions_list accepts status 'ignored'
  // and an agent told "pair up the unpaired transactions" gets there.
  //
  // Note that 'foreign_account' stays assignable on purpose — the owner's
  // configured accountNumber may simply be wrong, and overriding it is a
  // legitimate thing to want. Only the CURRENCY is unfixable by an assign.
  if (row.currency !== 'CZK') {
    throw new AppError('bad_request',
      `transakce je v ${row.currency}, ne v CZK — částku v jiné měně nelze zapsat jako platbu v korunách`);
  }

  const [c] = await db.select().from(contract)
    .where(and(eq(contract.id, contractId), eq(contract.orgId, orgId)));
  if (!c) throw new AppError('not_found', 'pronájem nenalezen');

  await db.transaction(async (tx) => {
    // allowedPropertyIds is null because every route into here is requireOwner,
    // and the contract was checked against the org just above. recordPayment
    // throws AppError('conflict') naming the existing payment when the
    // fingerprint matches and confirmDuplicate was not asked for — that throw
    // rolls the transaction back, so nothing is half-written.
    const created = await recordPayment(tx, orgId, null, {
      contractId,
      amount: row.amount, paidAt: row.valueDate,
      counterparty: null, counterpartyAccount: row.fromAccount,
      externalId: `kbemail:${row.messageId}`,
      statementRef: row.sourceLink, source: 'bank',
      description: buildDescription(row), // row satisfies DescribableTransaction
      allowDuplicate: confirmDuplicate,
    });
    await tx.update(bankTransaction)
      .set({ paymentId: created.id, status: 'matched', matchedBy: 'manual', statusReason: null })
      .where(eq(bankTransaction.id, id));
  });
  return getBankTransaction(db, orgId, id);
}

export async function ignoreBankTransaction(db: DB, orgId: string, id: string): Promise<BankTransactionRow> {
  const row = await getRaw(db, orgId, id);
  if (row.paymentId !== null) throw new AppError('conflict', 'transakce už je spárovaná — nejdřív smaž platbu');
  await db.update(bankTransaction).set({ status: 'ignored' }).where(eq(bankTransaction.id, id));
  return getBankTransaction(db, orgId, id);
}

/**
 * Re-run the parser over the stored token snapshot, after a parser fix. No IMAP
 * involved — this is why rawTokens is persisted.
 */
export async function reparseBankTransaction(db: DB, orgId: string, id: string): Promise<BankTransactionRow> {
  const row = await getRaw(db, orgId, id);
  if (!row.rawTokens || row.rawTokens.length === 0) {
    throw new AppError('bad_request', 'transakce nemá uložená data k opětovnému zpracování');
  }
  const result = parseFromTokens(row.rawTokens, {
    messageId: row.messageId, receivedAt: row.receivedAt, sourceLink: row.sourceLink,
  });
  if (!result.ok) {
    await db.update(bankTransaction)
      .set({ status: 'parse_failed', statusReason: `${result.reason}: ${result.detail}` })
      .where(eq(bankTransaction.id, id));
    return getBankTransaction(db, orgId, id);
  }
  const p = result.value;
  // Back to 'unmatched' rather than re-running the rules: a reparse is a repair
  // of the record, and the next sync (or a manual assign) does the pairing.
  await db.update(bankTransaction).set({
    amount: p.amount, currency: p.currency, valueDate: p.valueDate,
    fromAccount: p.fromAccount, toAccount: p.toAccount,
    vs: p.vs, ks: p.ks, ss: p.ss, messageForRecipient: p.messageForRecipient,
    status: 'unmatched', statusReason: null,
  }).where(eq(bankTransaction.id, id));
  return getBankTransaction(db, orgId, id);
}
