import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { freshDb } from './helpers/db.js';
import {
  organization, property, tenant, contract, payment,
  bankIntegration, bankTransaction, paymentMatchingRule, bankSyncRun,
} from '../core/db/schema.js';

async function seed() {
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
    imapHost: 'imap.example.com', imapUser: 'u@example.com', imapPasswordEnc: 'v1:a:b:c',
  });
  return { db, client, orgId, propertyId, contractId, integrationId };
}

const txValues = (o: { orgId: string; integrationId: string; messageId: string }) => ({
  id: createId(), ...o,
  amount: 3_800_000, currency: 'CZK', valueDate: '2026-08-20',
  status: 'unmatched' as const, receivedAt: new Date(),
});

describe('bank schema', () => {
  it('applies defaults on bank_integration', async () => {
    const { db, client, integrationId } = await seed();
    const [row] = await db.select().from(bankIntegration).where(eq(bankIntegration.id, integrationId));
    expect(row!.imapPort).toBe(993);
    expect(row!.imapFolder).toBe('INBOX');
    expect(row!.fromFilter).toBe('servis@kbinfo.cz');
    expect(row!.subjectFilter).toBe('Přijali jsme platbu');
    expect(row!.active).toBe(true);
    expect(row!.lastUid).toBeNull();
    await client.close();
  });

  it('enforces one bank_transaction per (orgId, messageId)', async () => {
    const { db, client, orgId, integrationId } = await seed();
    await db.insert(bankTransaction).values(txValues({ orgId, integrationId, messageId: 'm1' }));
    await expect(
      db.insert(bankTransaction).values(txValues({ orgId, integrationId, messageId: 'm1' })),
    ).rejects.toThrow();
    await client.close();
  });

  it('allows the same messageId in a different org', async () => {
    const { db, client, orgId, integrationId } = await seed();
    await db.insert(bankTransaction).values(txValues({ orgId, integrationId, messageId: 'm1' }));
    const otherOrg = createId();
    await db.insert(organization).values({ id: otherOrg, name: 'O2' });
    const otherIntegration = createId();
    await db.insert(bankIntegration).values({
      id: otherIntegration, orgId: otherOrg, kind: 'kb_email', name: 'KB2',
      imapHost: 'h', imapUser: 'u', imapPasswordEnc: 'v1:a:b:c',
    });
    await expect(
      db.insert(bankTransaction).values(txValues({ orgId: otherOrg, integrationId: otherIntegration, messageId: 'm1' })),
    ).resolves.toBeDefined();
    await client.close();
  });

  // paymentId IS NULL is the source of truth for "needs attention", so the FK
  // must null out rather than cascade the transaction away with the payment.
  it('nulls paymentId when the payment is deleted, keeping the transaction', async () => {
    const { db, client, orgId, integrationId, contractId } = await seed();
    const paymentId = createId();
    await db.insert(payment).values({
      id: paymentId, orgId, contractId, amount: 3_800_000,
      paidAt: '2026-08-20', source: 'bank', externalId: 'kbemail:m1',
    });
    const txId = createId();
    await db.insert(bankTransaction).values({
      ...txValues({ orgId, integrationId, messageId: 'm1' }),
      id: txId, status: 'matched', matchedBy: 'rule', paymentId,
    });

    await db.delete(payment).where(eq(payment.id, paymentId));

    const [row] = await db.select().from(bankTransaction).where(eq(bankTransaction.id, txId));
    expect(row).toBeDefined();
    expect(row!.paymentId).toBeNull();
    await client.close();
  });

  it('supports the self-reference used for suspected duplicates', async () => {
    const { db, client, orgId, integrationId } = await seed();
    const originalId = createId();
    await db.insert(bankTransaction).values({ ...txValues({ orgId, integrationId, messageId: 'm1' }), id: originalId });
    await db.insert(bankTransaction).values({
      ...txValues({ orgId, integrationId, messageId: 'm2' }),
      status: 'suspected_duplicate', duplicateOfTransactionId: originalId,
    });
    const rows = await db.select().from(bankTransaction).where(eq(bankTransaction.duplicateOfTransactionId, originalId));
    expect(rows).toHaveLength(1);
    await client.close();
  });

  it('enforces one matching rule per contract', async () => {
    const { db, client, orgId, contractId } = await seed();
    await db.insert(paymentMatchingRule).values({ id: createId(), orgId, contractId, vs: '2026008' });
    await expect(
      db.insert(paymentMatchingRule).values({ id: createId(), orgId, contractId, vs: '999' }),
    ).rejects.toThrow();
    await client.close();
  });

  it('stores a sync run with counters', async () => {
    const { db, client, integrationId } = await seed();
    const id = createId();
    await db.insert(bankSyncRun).values({ id, integrationId, trigger: 'cron', status: 'ok', fetched: 3, created: 2, matched: 1, failed: 0 });
    const [row] = await db.select().from(bankSyncRun).where(eq(bankSyncRun.id, id));
    expect(row!.fetched).toBe(3);
    expect(row!.finishedAt).toBeNull();
    await client.close();
  });

  it('cascades transactions and runs when the integration is deleted', async () => {
    const { db, client, orgId, integrationId } = await seed();
    await db.insert(bankTransaction).values(txValues({ orgId, integrationId, messageId: 'm1' }));
    await db.insert(bankSyncRun).values({ id: createId(), integrationId, trigger: 'manual', status: 'ok' });
    await db.delete(bankIntegration).where(eq(bankIntegration.id, integrationId));
    expect(await db.select().from(bankTransaction)).toHaveLength(0);
    expect(await db.select().from(bankSyncRun)).toHaveLength(0);
    await client.close();
  });
});
