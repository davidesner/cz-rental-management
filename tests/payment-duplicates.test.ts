import { describe, it, expect } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { freshDb } from './helpers/db.js';
import { organization, property, tenant, contract, payment } from '../core/db/schema.js';
import { recordPayment, recordPaymentsBatch } from '../core/services/payment.js';

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
  return { db, client, orgId, propertyId, contractId };
}

const MONEY = { amount: 3_850_000, paidAt: '2026-08-20', source: 'bank' as const };

describe('payment duplicate detection', () => {
  it('refuses a second payment for the same contract, amount and date', async () => {
    const { db, client, orgId, propertyId, contractId } = await seed();
    const first = await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'a' });

    await expect(recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'b' }))
      .rejects.toMatchObject({ kind: 'conflict' });

    // The message has to be actionable: which payment, and which channel wrote it.
    await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'b' })
      .catch((e: Error) => {
        expect(e.message).toContain(first.id);
        expect(e.message).toContain('bank');       // the existing row's source
        expect(e.message).toContain('externalId'); // says WHICH match this was
      });

    expect(await db.select().from(payment)).toHaveLength(1);
    await client.close();
  });

  it('creates it anyway with allowDuplicate — two genuinely separate transfers on one day', async () => {
    const { db, client, orgId, propertyId, contractId } = await seed();
    await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'a' });

    const second = await recordPayment(db, orgId, [propertyId], {
      contractId, ...MONEY, externalId: 'b', allowDuplicate: true,
    });

    expect(second.id).toBeTruthy();
    expect(await db.select().from(payment)).toHaveLength(2);
    await client.close();
  });

  it('leaves the externalId branch exactly as it was — same record re-sent is idempotent SUCCESS', async () => {
    const { db, client, orgId, propertyId, contractId } = await seed();
    const first = await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'a' });

    // Same externalId means "this is the same source record, retried". That must
    // still return the existing row rather than throw — the asymmetry with the
    // fingerprint case is deliberate, and this pins it.
    const again = await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'a' });

    expect(again.id).toBe(first.id);
    expect(await db.select().from(payment)).toHaveLength(1);
    await client.close();
  });

  it('never treats an UNASSIGNED payment as a duplicate', async () => {
    const { db, client, orgId, propertyId } = await seed();
    // No contract to fingerprint against, so the check is skipped entirely.
    await recordPayment(db, orgId, [propertyId], { contractId: null, ...MONEY, externalId: 'a' });
    await recordPayment(db, orgId, [propertyId], { contractId: null, ...MONEY, externalId: 'b' });

    expect(await db.select().from(payment)).toHaveLength(2);
    await client.close();
  });

  it('does not confuse a different contract, amount or date for a duplicate', async () => {
    const { db, client, orgId, propertyId, contractId } = await seed();
    await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'a' });

    await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, amount: 3_850_001, externalId: 'b' });
    await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, paidAt: '2026-08-21', externalId: 'c' });

    expect(await db.select().from(payment)).toHaveLength(3);
    await client.close();
  });

  // THE test that proves the Critical is closed. The e-mail sync already made the
  // payment; the annual-reconciliation workflow then imports the same transfer
  // from a bank statement with a SHA hash as externalId. The two namespaces never
  // collide, so externalId idempotency cannot see it — before this guard, this
  // call created a second payment and reconciliation reported a huge overpayment.
  it('refuses the STATEMENT-IMPORT direction: same money, different externalId namespace', async () => {
    const { db, client, orgId, propertyId, contractId } = await seed();
    // Exactly what core/services/bank-sync.ts writes.
    await recordPayment(db, orgId, [propertyId], {
      contractId, ...MONEY, externalId: 'kbemail:<CAF=abc123@mail.kb.cz>',
    });

    // Exactly what the skill's record_payments off a statement writes.
    await expect(recordPayment(db, orgId, [propertyId], {
      contractId, ...MONEY, externalId: 'sha256:9f2b1c0d4e5a6f7b8c9d0e1f2a3b4c5d',
    })).rejects.toMatchObject({ kind: 'conflict' });

    expect(await db.select().from(payment)).toHaveLength(1);
    await client.close();
  });

  // Item 9: the symbols are stored on `payment` too, not only on
  // `bank_transaction`, because a statement-imported payment has no
  // bank_transaction row to join to.
  describe('pairing symbols round-trip', () => {
    it('stores and returns vs/ks/ss', async () => {
      const { db, client, orgId, propertyId, contractId } = await seed();
      const p = await recordPayment(db, orgId, [propertyId], {
        contractId, ...MONEY, externalId: 'a', vs: '2026008', ks: '0308', ss: '77',
      });

      expect(p.vs).toBe('2026008');
      expect(p.ks).toBe('0308');
      expect(p.ss).toBe('77');

      const [stored] = await db.select().from(payment);
      expect([stored!.vs, stored!.ks, stored!.ss]).toEqual(['2026008', '0308', '77']);
      await client.close();
    });

    it('defaults them to null when a caller omits them entirely', async () => {
      const { db, client, orgId, propertyId, contractId } = await seed();
      // Every caller predating these columns looks exactly like this.
      const p = await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'a' });
      expect([p.vs, p.ks, p.ss]).toEqual([null, null, null]);
      await client.close();
    });

    it('carries them through a batch import', async () => {
      const { db, client, orgId, propertyId, contractId } = await seed();
      const r = await recordPaymentsBatch(db, orgId, [propertyId], [
        { contractId, ...MONEY, externalId: 'a', vs: '2026008' },
      ]);
      expect(r.created[0]!.vs).toBe('2026008');
      await client.close();
    });

    // Reported, never matched on: the fingerprint stays contract + amount + date.
    it('names the existing payment\'s VS in the conflict message', async () => {
      const { db, client, orgId, propertyId, contractId } = await seed();
      await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'a', vs: '2026008' });

      await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'b' })
        .then(() => { throw new Error('expected a conflict'); })
        .catch((e: Error) => expect(e.message).toContain('VS 2026008'));
      await client.close();
    });

    it('does not let a DIFFERING vs stop the duplicate guard', async () => {
      const { db, client, orgId, propertyId, contractId } = await seed();
      await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'a', vs: '111' });
      // Same money, different symbol. The symbols are not part of the
      // fingerprint, so this is still refused — that is the intended behaviour,
      // since a bank can and does restate a symbol.
      await expect(recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'b', vs: '222' }))
        .rejects.toMatchObject({ kind: 'conflict' });
      await client.close();
    });
  });

  describe('recordPaymentsBatch', () => {
    it('reports a duplicate in `duplicates` and still imports the rest of the batch', async () => {
      const { db, client, orgId, propertyId, contractId } = await seed();
      const seeded = await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'kbemail:m1' });

      // A statement import: three rows, the middle one already accounted for. The
      // whole batch is ONE transaction, so a throw would roll back the other two
      // and make the import all-or-nothing on its noisiest row.
      const result = await recordPaymentsBatch(db, orgId, [propertyId], [
        { contractId, ...MONEY, paidAt: '2026-07-20', externalId: 'sha:jul' },
        { contractId, ...MONEY, externalId: 'sha:aug' },
        { contractId, ...MONEY, paidAt: '2026-09-20', externalId: 'sha:sep' },
      ]);

      expect(result.created).toHaveLength(2);
      expect(result.existing).toHaveLength(0);
      expect(result.duplicates).toHaveLength(1);
      // `duplicates` carries the row that ALREADY covers the money, which is what
      // the caller needs in order to show the user what blocked them.
      expect(result.duplicates[0]!.id).toBe(seeded.id);
      expect(await db.select().from(payment)).toHaveLength(3);
      await client.close();
    });

    it('keeps `existing` and `duplicates` apart — they mean different things', async () => {
      const { db, client, orgId, propertyId, contractId } = await seed();
      await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'sha:aug' });

      const result = await recordPaymentsBatch(db, orgId, [propertyId], [
        // Same externalId: the same record, re-sent.
        { contractId, ...MONEY, externalId: 'sha:aug' },
        // Different externalId, same money: a DIFFERENT record for it.
        { contractId, ...MONEY, externalId: 'kbemail:m1' },
      ]);

      expect(result.existing).toHaveLength(1);
      expect(result.duplicates).toHaveLength(1);
      expect(result.created).toHaveLength(0);
      await client.close();
    });

    it('catches two identical rows inside ONE batch', async () => {
      const { db, client, orgId, propertyId, contractId } = await seed();
      const result = await recordPaymentsBatch(db, orgId, [propertyId], [
        { contractId, ...MONEY, externalId: 'sha:a' },
        { contractId, ...MONEY, externalId: 'sha:b' },
      ]);

      // The first insert is visible to the second's lookup: same transaction.
      expect(result.created).toHaveLength(1);
      expect(result.duplicates).toHaveLength(1);
      expect(await db.select().from(payment)).toHaveLength(1);
      await client.close();
    });

    it('honours allowDuplicate per payment', async () => {
      const { db, client, orgId, propertyId, contractId } = await seed();
      await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'sha:a' });

      const result = await recordPaymentsBatch(db, orgId, [propertyId], [
        { contractId, ...MONEY, externalId: 'sha:b', allowDuplicate: true },
      ]);

      expect(result.created).toHaveLength(1);
      expect(result.duplicates).toHaveLength(0);
      await client.close();
    });
  });
});
