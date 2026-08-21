import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { freshDb, type DB } from './helpers/db.js';
import { fakeImap, fakeImapByUser, failingImap } from './helpers/fake-imap.js';
import { loadFixtureHtml, makeEml, setFieldValue } from './helpers/kb-email.js';
import { seal } from '../core/lib/crypto-box.js';
import { syncIntegration, syncAllActiveIntegrations, buildDescription } from '../core/services/bank-sync.js';
import { assignBankTransaction } from '../core/services/bank-transaction.js';
import {
  organization, property, tenant, contract, payment,
  bankIntegration, bankTransaction, paymentMatchingRule, bankSyncRun,
} from '../core/db/schema.js';

const KEY = randomBytes(32);
const PASSWORD = 'app-password-1234';

// The fixture's own accounts, set by scripts/sanitize-kb-fixture.py
const FROM_ACCOUNT = '123-1234567890/0100';
const TO_ACCOUNT = '321-9876543210/0100';

interface Ctx { db: DB; close: () => Promise<void>; orgId: string; contractId: string; integrationId: string }

async function setup(opts: { accountNumber?: string | null } = {}): Promise<Ctx> {
  const { db, client } = await freshDb();
  const orgId = createId();
  await db.insert(organization).values({ id: orgId, name: 'O' });
  const propertyId = createId();
  await db.insert(property).values({ id: propertyId, orgId, name: 'P' });
  const tenantId = createId();
  await db.insert(tenant).values({ id: tenantId, orgId, name: 'T' });
  const contractId = createId();
  await db.insert(contract).values({ id: contractId, orgId, propertyId, tenantId, startDate: '2024-09-01' });
  const integrationId = createId();
  await db.insert(bankIntegration).values({
    id: integrationId, orgId, kind: 'kb_email', name: 'KB',
    imapHost: 'imap.example.com', imapUser: 'u@example.com',
    imapPasswordEnc: seal(PASSWORD, KEY),
    accountNumber: opts.accountNumber === undefined ? TO_ACCOUNT : opts.accountNumber,
  });
  return { db, close: client.close, orgId, contractId, integrationId };
}

async function addRule(db: DB, orgId: string, contractId: string, o: Record<string, unknown> = {}) {
  await db.insert(paymentMatchingRule).values({
    id: createId(), orgId, contractId,
    counterpartyAccount: FROM_ACCOUNT, amountFrom: 2000, amountTo: 4000,
    ...o,
  });
}

/**
 * A SECOND tenant of the app in the same database: its own org, property,
 * tenant, contract and bank integration, reachable through its own imapUser.
 */
async function addOrg(db: DB, imapUser: string) {
  const orgId = createId();
  await db.insert(organization).values({ id: orgId, name: `O-${imapUser}` });
  const propertyId = createId();
  await db.insert(property).values({ id: propertyId, orgId, name: 'P' });
  const tenantId = createId();
  await db.insert(tenant).values({ id: tenantId, orgId, name: 'T' });
  const contractId = createId();
  await db.insert(contract).values({ id: contractId, orgId, propertyId, tenantId, startDate: '2024-09-01' });
  const integrationId = createId();
  await db.insert(bankIntegration).values({
    id: integrationId, orgId, kind: 'kb_email', name: 'KB',
    imapHost: 'imap.example.com', imapUser,
    imapPasswordEnc: seal(PASSWORD, KEY),
    accountNumber: TO_ACCOUNT,
  });
  return { orgId, contractId, integrationId };
}

/** A KB notification with a distinct Message-ID. Amount is 30,00 Kč = 3000 haléře. */
async function notification(messageId: string, mutate?: (html: string) => string): Promise<Buffer> {
  let html = await loadFixtureHtml();
  if (mutate) html = mutate(html);
  return makeEml(html, { messageId: `<${messageId}>` });
}

const deps = (messages: Array<{ uid: number; source: Buffer }>) => ({
  ...fakeImap(messages), key: KEY,
});

describe('bank-sync', () => {
  it('imports a notification and pairs it to the matching contract', async () => {
    const c = await setup();
    await addRule(c.db, c.orgId, c.contractId);
    const d = deps([{ uid: 10, source: await notification('m1') }]);

    const result = await syncIntegration(c.db, c.integrationId, d, 'manual');

    expect(result.status).toBe('ok');
    expect(result.fetched).toBe(1);
    expect(result.created).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.failed).toBe(0);

    // The decrypted password reached the fetcher
    expect(d.calls[0]!.password).toBe(PASSWORD);

    const [tx] = await c.db.select().from(bankTransaction);
    expect(tx!.status).toBe('matched');
    expect(tx!.matchedBy).toBe('rule');
    expect(tx!.amount).toBe(3000);
    expect(tx!.currency).toBe('CZK');
    expect(tx!.valueDate).toBe('2026-08-20');
    expect(tx!.fromAccount).toBe(FROM_ACCOUNT);
    expect(tx!.messageId).toBe('m1');
    expect(tx!.rawTokens!.length).toBeGreaterThan(10);
    expect(tx!.paymentId).not.toBeNull();

    const [p] = await c.db.select().from(payment);
    expect(p!.contractId).toBe(c.contractId);
    expect(p!.amount).toBe(3000);
    expect(p!.paidAt).toBe('2026-08-20');
    expect(p!.source).toBe('bank');
    expect(p!.externalId).toBe('kbemail:m1');
    expect(p!.counterpartyAccount).toBe(FROM_ACCOUNT);
    expect(p!.counterparty).toBeNull(); // KB sends no payer name

    // The integration is healthy and the cursor advanced
    const [integ] = await c.db.select().from(bankIntegration).where(eq(bankIntegration.id, c.integrationId));
    expect(integ!.lastSyncStatus).toBe('ok');
    expect(integ!.lastSyncError).toBeNull();
    expect(integ!.lastUid).toBe(10);
    expect(integ!.lastSyncAt).not.toBeNull();
    await c.close();
  });

  it('is idempotent — a second run over the same message creates nothing', async () => {
    const c = await setup();
    await addRule(c.db, c.orgId, c.contractId);
    const msg = { uid: 10, source: await notification('m1') };

    await syncIntegration(c.db, c.integrationId, deps([msg]), 'manual');
    // Offer the SAME Message-ID again at a HIGHER uid. This matters: fakeImap
    // honours the cursor, so re-offering uid 10 would be withheld by the fake and
    // the test would pass without the (orgId, messageId) dedupe existing at all.
    // A higher uid gets past the cursor, so the only thing that can stop a second
    // payment is the dedupe this test is named after.
    const second = await syncIntegration(c.db, c.integrationId,
      { ...fakeImap([{ uid: 11, source: await notification('m1') }]), key: KEY }, 'cron');

    // A clean skip, not a swallowed error: without the dedupe, this insert
    // would hit the payment(orgId, externalId) unique index and the run would
    // report 'error' even though the rolled-back row counts look identical.
    expect(second.status).toBe('ok');
    expect(second.created).toBe(0);
    expect(await c.db.select().from(bankTransaction)).toHaveLength(1);
    expect(await c.db.select().from(payment)).toHaveLength(1);
    await c.close();
  });

  it('leaves an unmatched transaction in the inbox with no payment', async () => {
    const c = await setup();
    // No rule at all
    const result = await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');

    expect(result.matched).toBe(0);
    const [tx] = await c.db.select().from(bankTransaction);
    expect(tx!.status).toBe('unmatched');
    expect(tx!.paymentId).toBeNull();
    expect(await c.db.select().from(payment)).toHaveLength(0);
    await c.close();
  });

  it('records ambiguity and creates no payment when two contracts match', async () => {
    const c = await setup();
    await addRule(c.db, c.orgId, c.contractId);
    // A second contract on the same property with an identically wide rule
    const otherContract = createId();
    const [prop] = await c.db.select().from(property);
    const [ten] = await c.db.select().from(tenant);
    await c.db.insert(contract).values({
      id: otherContract, orgId: c.orgId, propertyId: prop!.id, tenantId: ten!.id, startDate: '2024-09-01',
    });
    await addRule(c.db, c.orgId, otherContract);

    await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');

    const [tx] = await c.db.select().from(bankTransaction);
    expect(tx!.status).toBe('ambiguous');
    expect(tx!.paymentId).toBeNull();
    expect(tx!.statusReason).toContain(c.contractId);
    expect(tx!.statusReason).toContain(otherContract);
    expect(await c.db.select().from(payment)).toHaveLength(0);
    await c.close();
  });

  it('ignores a notification addressed to a different account of ours', async () => {
    const c = await setup({ accountNumber: '555-5555555555/0800' });
    await addRule(c.db, c.orgId, c.contractId);

    await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');

    const [tx] = await c.db.select().from(bankTransaction);
    expect(tx!.status).toBe('ignored');
    expect(tx!.statusReason).toBe('foreign_account');
    expect(await c.db.select().from(payment)).toHaveLength(0);
    await c.close();
  });

  it('ignores a non-CZK notification', async () => {
    const c = await setup();
    await addRule(c.db, c.orgId, c.contractId);
    const eur = await notification('m1', (html) => html
      .replace(/30,00(&nbsp;| )Kč/, '30,00$1EUR')
      .replace('30.00 CZK', '30.00 EUR'));

    await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: eur }]), 'manual');

    const [tx] = await c.db.select().from(bankTransaction);
    expect(tx!.status).toBe('ignored');
    expect(tx!.statusReason).toBe('unsupported_currency');
    expect(await c.db.select().from(payment)).toHaveLength(0);
    await c.close();
  });

  // row.amount for a EUR notification holds euro CENTS. payment.amount is CZK
  // haléře, so assigning one would silently turn 30,00 EUR into 30,00 Kč — and
  // an ignored/unsupported_currency row is otherwise perfectly assignable, via
  // two MCP calls or one click in the inbox.
  it('refuses to assign a transaction that is not in CZK', async () => {
    const c = await setup();
    const eur = await notification('m1', (html) => html
      .replace(/30,00(&nbsp;| )Kč/, '30,00$1EUR')
      .replace('30.00 CZK', '30.00 EUR'));
    await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: eur }]), 'manual');
    const [tx] = await c.db.select().from(bankTransaction);
    expect(tx!.currency).toBe('EUR');

    await expect(assignBankTransaction(c.db, c.orgId, tx!.id, c.contractId))
      .rejects.toMatchObject({ kind: 'bad_request' });
    expect(await c.db.select().from(payment)).toHaveLength(0);
    await c.close();
  });

  // Item 9: payment.vs/ks/ss exist so a statement-imported row and an
  // e-mail-imported row carry the same information. Both write paths must fill
  // them, or the columns are decorative.
  // The base fixture's symbol fields are EMPTY, so a notification built from it
  // would assert null === null and prove nothing. Populate them first.
  const withSymbols = (messageId: string) => notification(messageId, (html) => {
    html = setFieldValue(html, 'Variabilní symbol', '2026008');
    html = setFieldValue(html, 'Konstantní symbol', '0308');
    return setFieldValue(html, 'Specifický symbol', '77');
  });

  it('carries the notification symbols onto the payment it creates', async () => {
    const c = await setup();
    await addRule(c.db, c.orgId, c.contractId);
    await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await withSymbols('m1') }]), 'manual');

    const [tx] = await c.db.select().from(bankTransaction);
    const [p] = await c.db.select().from(payment);
    expect([tx!.vs, tx!.ks, tx!.ss]).toEqual(['2026008', '0308', '77']);
    expect([p!.vs, p!.ks, p!.ss]).toEqual([tx!.vs, tx!.ks, tx!.ss]);
    await c.close();
  });

  it('carries the transaction symbols onto a MANUALLY assigned payment', async () => {
    const c = await setup();
    // No rule, so the row parks as unmatched and the only way through is assign.
    await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await withSymbols('m1') }]), 'manual');
    const [tx] = await c.db.select().from(bankTransaction);
    expect(tx!.paymentId).toBeNull();
    expect(tx!.vs).toBe('2026008');

    await assignBankTransaction(c.db, c.orgId, tx!.id, c.contractId);

    const [p] = await c.db.select().from(payment);
    expect([p!.vs, p!.ks, p!.ss]).toEqual([tx!.vs, tx!.ks, tx!.ss]);
    await c.close();
  });

  describe('the resend guard', () => {
    it('holds a re-sent notification as suspected_duplicate and creates no second payment', async () => {
      const c = await setup();
      await addRule(c.db, c.orgId, c.contractId);
      await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');

      // Same money, different Message-ID — KB re-sent the notification.
      const resend = { uid: 11, source: await notification('m2') };
      const result = await syncIntegration(c.db, c.integrationId, { ...fakeImap([resend]), key: KEY }, 'cron');

      expect(result.created).toBe(1);   // the record exists...
      expect(result.matched).toBe(0);   // ...but no payment was made
      expect(await c.db.select().from(payment)).toHaveLength(1);

      const dup = (await c.db.select().from(bankTransaction).where(eq(bankTransaction.messageId, 'm2')))[0];
      expect(dup!.status).toBe('suspected_duplicate');
      expect(dup!.paymentId).toBeNull();
      const original = (await c.db.select().from(bankTransaction).where(eq(bankTransaction.messageId, 'm1')))[0];
      expect(dup!.duplicateOfTransactionId).toBe(original!.id);
      await c.close();
    });

    // Held-not-discarded only works if the hold can be RELEASED. Duplicate
    // detection lives in recordPayment now, so without an explicit override it
    // would refuse the very click whose whole purpose is to say "I looked, this
    // is a separate transfer".
    it('releases a parked suspected_duplicate on assign with confirmDuplicate', async () => {
      const c = await setup();
      await addRule(c.db, c.orgId, c.contractId);
      await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');
      await syncIntegration(c.db, c.integrationId,
        { ...fakeImap([{ uid: 11, source: await notification('m2') }]), key: KEY }, 'cron');
      const parked = (await c.db.select().from(bankTransaction).where(eq(bankTransaction.messageId, 'm2')))[0]!;
      expect(parked.status).toBe('suspected_duplicate');

      // Without the override, a careless assign is still caught.
      await expect(assignBankTransaction(c.db, c.orgId, parked.id, c.contractId))
        .rejects.toMatchObject({ kind: 'conflict' });
      expect(await c.db.select().from(payment)).toHaveLength(1);

      // With it — the „Není duplikát — spárovat" click — it goes through.
      const released = await assignBankTransaction(c.db, c.orgId, parked.id, c.contractId, true);
      expect(released.status).toBe('matched');
      expect(released.matchedBy).toBe('manual');
      expect(released.paymentId).not.toBeNull();
      expect(await c.db.select().from(payment)).toHaveLength(2);
      await c.close();
    });

    it('does not flag a different amount as a duplicate', async () => {
      const c = await setup();
      await addRule(c.db, c.orgId, c.contractId, { amountFrom: 1000, amountTo: 5000 });
      await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');

      const other = await notification('m2', (html) => html
        .replace(/30,00(&nbsp;| )Kč/, '31,00$1Kč')
        .replace('30.00 CZK', '31.00 CZK'));
      await syncIntegration(c.db, c.integrationId, { ...fakeImap([{ uid: 11, source: other }]), key: KEY }, 'cron');

      const tx = (await c.db.select().from(bankTransaction).where(eq(bankTransaction.messageId, 'm2')))[0];
      expect(tx!.status).toBe('matched');
      expect(await c.db.select().from(payment)).toHaveLength(2);
      await c.close();
    });

    // The annual-reconciliation workflow imports the same transfers from a bank
    // statement with a SHA hash as externalId, so `kbemail:<messageId>` never
    // collides with it and recordPayment's externalId-equality idempotency never
    // fires. Without this guard the 90-day backfill (or simply both channels
    // running) writes the SAME transfer twice and reconciliation reports a huge
    // overpayment.
    it('parks a transfer a MANUALLY-ENTERED payment already covers, whatever its externalId', async () => {
      const c = await setup();
      await addRule(c.db, c.orgId, c.contractId);
      // Exactly what `record_payments` off a statement would have written: same
      // contract, same amount, same date — different source, different externalId.
      await c.db.insert(payment).values({
        id: createId(), orgId: c.orgId, contractId: c.contractId,
        amount: 3000, paidAt: '2026-08-20', source: 'bank',
        externalId: 'sha256:deadbeef',
      });

      const result = await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'cron');

      expect(result.created).toBe(1);   // the record exists...
      expect(result.matched).toBe(0);   // ...but no SECOND payment was made
      expect(await c.db.select().from(payment)).toHaveLength(1);

      const [tx] = await c.db.select().from(bankTransaction);
      expect(tx!.status).toBe('suspected_duplicate');
      expect(tx!.paymentId).toBeNull();
      expect(tx!.statusReason).toContain('už na tomto pronájmu existuje');
      await c.close();
    });

    it('refuses a MANUAL assign of a transfer an existing payment already covers', async () => {
      const c = await setup();
      await addRule(c.db, c.orgId, c.contractId);
      await c.db.insert(payment).values({
        id: createId(), orgId: c.orgId, contractId: c.contractId,
        amount: 3000, paidAt: '2026-08-20', source: 'bank',
        externalId: 'sha256:deadbeef',
      });
      await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'cron');
      const [tx] = await c.db.select().from(bankTransaction);

      // The inbox's "Není duplikát — spárovat" must not become the way to
      // double-count: refused loudly, and still no second payment.
      await expect(assignBankTransaction(c.db, c.orgId, tx!.id, c.contractId))
        .rejects.toMatchObject({ kind: 'conflict' });
      expect(await c.db.select().from(payment)).toHaveLength(1);
      await c.close();
    });

    it('does not flag a duplicate of a transaction that produced no payment', async () => {
      const c = await setup();
      // No rule → first import is unmatched, paymentId null
      await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');
      await syncIntegration(c.db, c.integrationId, { ...fakeImap([{ uid: 11, source: await notification('m2') }]), key: KEY }, 'cron');

      const tx = (await c.db.select().from(bankTransaction).where(eq(bankTransaction.messageId, 'm2')))[0];
      expect(tx!.status).toBe('unmatched');
      await c.close();
    });
  });

  describe('failure handling', () => {
    it('stores a structurally-drifted message and escalates the integration to error', async () => {
      const c = await setup();
      const drifted = await notification('m1', (html) => html.replace('Variabilní symbol', 'Neznámé pole'));

      const result = await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: drifted }]), 'cron');

      expect(result.failed).toBe(1);
      expect(result.status).toBe('error');
      const [tx] = await c.db.select().from(bankTransaction);
      expect(tx!.status).toBe('parse_failed');
      expect(tx!.statusReason).toContain('Variabilní symbol');
      expect(tx!.rawTokens!.length).toBeGreaterThan(5);

      const [integ] = await c.db.select().from(bankIntegration).where(eq(bankIntegration.id, c.integrationId));
      expect(integ!.lastSyncStatus).toBe('error');
      expect(integ!.lastSyncError).toBeTruthy();
      // The cursor still advanced — one bad message must not wedge the
      // integration forever.
      expect(integ!.lastUid).toBe(10);
      await c.close();
    });

    it('persists a notification with no Message-ID header instead of losing it silently', async () => {
      const c = await setup();
      // Passes the sender + subject filters (a genuine KB notification) but has
      // no Message-ID header at all — built inline rather than via makeEml,
      // since makeEml always writes a Message-ID line (an empty override still
      // renders an empty header value, not an absent one).
      const html = await loadFixtureHtml();
      const headers = [
        'From: Komerční banka <servis@kbinfo.cz>',
        'To: landlord@example.com',
        'Subject: Servisní zpráva: Přijali jsme platbu na Váš účet',
        'Date: Thu, 20 Aug 2026 10:52:24 +0000',
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
      ].join('\r\n');
      const noMessageId = Buffer.from(`${headers}\r\n\r\n${html}`, 'utf8');

      const result = await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: noMessageId }]), 'cron');

      expect(result.failed).toBe(1);
      // Persisted, not lost: the cursor advances past uid 10 regardless (see
      // the test above), so a skipped insert here would mean this message is
      // neither stored nor ever re-offered.
      const [tx] = await c.db.select().from(bankTransaction);
      expect(tx!.status).toBe('parse_failed');
      expect(tx!.messageId).toMatch(/^imap:/);
      await c.close();
    });

    it('does not inflate the created counter when a parse failure is replayed', async () => {
      const c = await setup();
      const drifted = await notification('m1', (html) => html.replace('Variabilní symbol', 'Neznámé pole'));
      await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: drifted }]), 'cron');

      // Same Message-ID, higher uid — e.g. a uidValidity reset re-offering an
      // already-stored parse_failed row. The insert becomes a no-op via
      // onConflictDoNothing; `created` must reflect that, not the attempt.
      const second = await syncIntegration(c.db, c.integrationId,
        { ...fakeImap([{ uid: 11, source: drifted }]), key: KEY }, 'cron');

      expect(second.created).toBe(0);
      expect(second.failed).toBe(1);
      expect(await c.db.select().from(bankTransaction)).toHaveLength(1);
      await c.close();
    });

    it('a DB failure on one message does not stop the rest of the batch or freeze the cursor', async () => {
      const c = await setup();
      await addRule(c.db, c.orgId, c.contractId);
      // A payment already holding the externalId m1's import will try to write,
      // but for a DIFFERENT amount and date so the cross-channel duplicate guard
      // does not catch it first. The payment insert therefore reaches the DB and
      // violates payment_org_external_idx — the exact shape of the failure a
      // delete-and-re-add of an integration produces, since payments survive it
      // and bank_transaction rows do not.
      await c.db.insert(payment).values({
        id: createId(), orgId: c.orgId, contractId: c.contractId,
        amount: 999_99, paidAt: '2020-01-01', source: 'bank', externalId: 'kbemail:m1',
      });

      const result = await syncIntegration(c.db, c.integrationId, deps([
        { uid: 10, source: await notification('m1') },
        { uid: 11, source: await notification('m2') },
      ]), 'cron');

      // The run reports the failure...
      expect(result.status).toBe('error');
      expect(result.failed).toBe(1);
      expect(result.error).toContain('m1');
      // ...but the LATER message still imported.
      expect(result.created).toBe(1);
      expect(result.matched).toBe(1);
      const stored = await c.db.select().from(bankTransaction);
      expect(stored.map(t => t.messageId)).toEqual(['m2']);

      // And the cursor advanced past BOTH — otherwise the next run refetches m1,
      // fails identically, and the integration is wedged forever.
      const [integ] = await c.db.select().from(bankIntegration).where(eq(bankIntegration.id, c.integrationId));
      expect(integ!.lastUid).toBe(11);
      await c.close();
    });

    it('skips an unrelated e-mail WITHOUT escalating to error', async () => {
      const c = await setup();
      const unrelated = makeEml('<html><body><p>Newsletter</p></body></html>', {
        from: 'news@example.com', messageId: '<m9>',
      });

      const result = await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: unrelated }]), 'cron');

      expect(result.status).toBe('ok');
      expect(result.failed).toBe(0);
      expect(result.created).toBe(0);
      // Nothing stored — a stray message in the mailbox is not our business.
      expect(await c.db.select().from(bankTransaction)).toHaveLength(0);
      const [integ] = await c.db.select().from(bankIntegration).where(eq(bankIntegration.id, c.integrationId));
      expect(integ!.lastSyncStatus).toBe('ok');
      await c.close();
    });

    it('records a connection failure on the integration and the run', async () => {
      const c = await setup();
      const result = await syncIntegration(c.db, c.integrationId, { ...failingImap('AUTHENTICATIONFAILED'), key: KEY }, 'cron');

      expect(result.status).toBe('error');
      expect(result.error).toContain('AUTHENTICATIONFAILED');
      const [integ] = await c.db.select().from(bankIntegration).where(eq(bankIntegration.id, c.integrationId));
      expect(integ!.lastSyncStatus).toBe('error');
      expect(integ!.lastSyncError).toContain('AUTHENTICATIONFAILED');
      // lastSyncAt doubles as the SINCE search floor for the next run. Stamping
      // it on a FAILED run would strand fetched-but-unprocessed mail outside
      // that window and truncate the 90-day first-run backfill to "today" —
      // so a failed run must leave it untouched.
      expect(integ!.lastSyncAt).toBeNull();
      const [run] = await c.db.select().from(bankSyncRun);
      expect(run!.status).toBe('error');
      expect(run!.finishedAt).not.toBeNull();
      await c.close();
    });

    it('fails the run loudly when the encryption key is wrong', async () => {
      const c = await setup();
      const result = await syncIntegration(c.db, c.integrationId, { ...fakeImap([]), key: randomBytes(32) }, 'cron');
      expect(result.status).toBe('error');
      expect(result.error).toMatch(/BANK_SECRET_KEY|decrypt/i);
      await c.close();
    });
  });

  it('writes a sync run row with counters for every attempt', async () => {
    const c = await setup();
    await addRule(c.db, c.orgId, c.contractId);
    await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'cron');

    const [run] = await c.db.select().from(bankSyncRun);
    expect(run!.trigger).toBe('cron');
    expect(run!.status).toBe('ok');
    expect(run!.fetched).toBe(1);
    expect(run!.created).toBe(1);
    expect(run!.matched).toBe(1);
    expect(run!.finishedAt).not.toBeNull();
    await c.close();
  });

  describe('syncAllActiveIntegrations', () => {
    it('runs every active integration and skips inactive ones', async () => {
      const c = await setup();
      const inactive = createId();
      await c.db.insert(bankIntegration).values({
        id: inactive, orgId: c.orgId, kind: 'kb_email', name: 'Off',
        imapHost: 'h', imapUser: 'u', imapPasswordEnc: seal(PASSWORD, KEY), active: false,
      });

      const results = await syncAllActiveIntegrations(c.db, deps([{ uid: 10, source: await notification('m1') }]));

      expect(results).toHaveLength(1);
      expect(results[0]!.integrationId).toBe(c.integrationId);
      await c.close();
    });

    // syncAllActiveIntegrations is the ONE place in the codebase where orgId does
    // not come from ctx: the cron has no session, so it iterates every active
    // integration across all orgs and passes each integration's OWN orgId down.
    // The spec calls that "a deliberate, isolated exception to the multi-tenant
    // rule [that] needs a comment saying so at the call site, plus a test", and
    // the comment was there without the test. Every other test here is
    // single-org, and the cron-route test asserts results === [] — zero
    // integrations — so it pins the auth gate and nothing about the iteration.
    //
    // Note the rules in both orgs are identically wide: if loadCandidateRules
    // were NOT org-scoped, each transaction would match two contracts, come out
    // 'ambiguous', and create no payment at all.
    it('keeps two orgs separate — each payment lands in its own org', async () => {
      const a = await setup();                                  // imapUser u@example.com
      await addRule(a.db, a.orgId, a.contractId);
      const b = await addOrg(a.db, 'b@example.com');
      await addRule(a.db, b.orgId, b.contractId);

      const results = await syncAllActiveIntegrations(a.db, {
        ...fakeImapByUser({
          'u@example.com': [{ uid: 10, source: await notification('a1') }],
          'b@example.com': [{ uid: 10, source: await notification('b1') }],
        }),
        key: KEY,
      });

      expect(results).toHaveLength(2);
      expect(results.every(r => r.status === 'ok' && r.matched === 1)).toBe(true);

      const payments = await a.db.select().from(payment);
      expect(payments).toHaveLength(2);
      const byOrg = new Map(payments.map(p => [p.orgId, p]));
      expect(byOrg.get(a.orgId)!.contractId).toBe(a.contractId);
      expect(byOrg.get(b.orgId)!.contractId).toBe(b.contractId);

      // Each staging row stayed in its own org, and org A's rules never got a
      // shot at org B's transaction (or it would be ambiguous, not matched).
      const txs = await a.db.select().from(bankTransaction);
      expect(txs).toHaveLength(2);
      const txA = txs.find(t => t.messageId === 'a1')!;
      const txB = txs.find(t => t.messageId === 'b1')!;
      expect(txA.orgId).toBe(a.orgId);
      expect(txB.orgId).toBe(b.orgId);
      expect(txA.status).toBe('matched');
      expect(txB.status).toBe('matched');
      expect(txA.paymentId).toBe(byOrg.get(a.orgId)!.id);
      expect(txB.paymentId).toBe(byOrg.get(b.orgId)!.id);
      await a.close();
    });

    it('one failing integration does not stop the others', async () => {
      const c = await setup();
      const broken = createId();
      await c.db.insert(bankIntegration).values({
        id: broken, orgId: c.orgId, kind: 'kb_email', name: 'Broken',
        imapHost: 'h', imapUser: 'u', imapPasswordEnc: 'v1:garbage:garbage:garbage',
      });

      const results = await syncAllActiveIntegrations(c.db, deps([]));

      expect(results).toHaveLength(2);
      expect(results.filter(r => r.status === 'error')).toHaveLength(1);
      expect(results.filter(r => r.status === 'ok')).toHaveLength(1);
      await c.close();
    });
  });

  describe('buildDescription', () => {
    it('prefers messageForRecipient when present', () => {
      expect(buildDescription({ messageForRecipient: 'Nájem srpen 2026', vs: '123', ks: '0308', ss: '456' }))
        .toBe('Nájem srpen 2026');
    });

    it('falls back to VS · KS · SS when there is no message for recipient', () => {
      expect(buildDescription({ messageForRecipient: null, vs: '123', ks: '0308', ss: '456' }))
        .toBe('VS 123 · KS 0308 · SS 456');
    });

    it('omits absent symbols from the fallback rather than rendering them blank', () => {
      expect(buildDescription({ messageForRecipient: null, vs: '123', ks: null, ss: null }))
        .toBe('VS 123');
    });

    it('treats an empty-string message the same as absent', () => {
      expect(buildDescription({ messageForRecipient: '', vs: null, ks: '0308', ss: null }))
        .toBe('KS 0308');
    });

    it('returns null when there is nothing to describe at all', () => {
      expect(buildDescription({ messageForRecipient: null, vs: null, ks: null, ss: null })).toBeNull();
    });
  });
});
