import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { freshDb, type DB } from './helpers/db.js';
import { fakeImap, failingImap } from './helpers/fake-imap.js';
import { loadFixtureHtml, makeEml, setFieldValue } from './helpers/kb-email.js';
import { seal } from '../core/lib/crypto-box.js';
import { syncIntegration, syncAllActiveIntegrations } from '../core/services/bank-sync.js';
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
});
