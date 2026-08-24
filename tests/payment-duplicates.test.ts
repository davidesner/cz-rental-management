import { describe, it, expect } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { freshDb } from './helpers/db.js';
import { organization, property, tenant, contract, payment } from '../core/db/schema.js';
import { recordPayment, recordPaymentsBatch, assignPaymentToContract, updatePayment } from '../core/services/payment.js';

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

// Second contract on the same property, for the assign-onto-a-collision tests —
// assignPaymentToContract checks the TARGET contract's existing payments, so
// exercising it needs a payment sitting unassigned (or on a third contract)
// plus a second contract that already holds the colliding money.
async function seedTwoContracts() {
  const base = await seed();
  const tenantId2 = createId();
  await base.db.insert(tenant).values({ id: tenantId2, orgId: base.orgId, name: 'T2' });
  const contractId2 = createId();
  await base.db.insert(contract).values({
    id: contractId2, orgId: base.orgId, propertyId: base.propertyId, tenantId: tenantId2, startDate: '2024-09-01',
  });
  return { ...base, contractId2 };
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

  // Gap 2: the guard is insert-only no more. assignPaymentToContract and
  // updatePayment mutate an EXISTING row, so the fingerprint search must
  // exclude that row itself — otherwise every edit would collide with its own
  // fingerprint and the app would refuse every edit.
  describe('assignPaymentToContract duplicate detection', () => {
    it('refuses assigning an unassigned payment onto a contract that already has the same amount/date, and succeeds with the override', async () => {
      const { db, client, orgId, propertyId, contractId, contractId2 } = await seedTwoContracts();
      // contractId2 already has this money.
      await recordPayment(db, orgId, [propertyId], { contractId: contractId2, ...MONEY, externalId: 'a' });
      // An unassigned payment with the same amount/date.
      const incoming = await recordPayment(db, orgId, [propertyId], { contractId: null, ...MONEY, externalId: 'b' });

      await expect(assignPaymentToContract(db, orgId, incoming.id, [propertyId], contractId2))
        .rejects.toMatchObject({ kind: 'conflict' });

      const assigned = await assignPaymentToContract(db, orgId, incoming.id, [propertyId], contractId2, true);
      expect(assigned.contractId).toBe(contractId2);
      await client.close();
    });

    it('never refuses unassigning (contractId: null)', async () => {
      const { db, client, orgId, propertyId, contractId } = await seedTwoContracts();
      const p = await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'a' });

      const unassigned = await assignPaymentToContract(db, orgId, p.id, [propertyId], null);
      expect(unassigned.contractId).toBeNull();
      await client.close();
    });

    it('does not self-conflict when reassigning a payment to the contract it is already on', async () => {
      const { db, client, orgId, propertyId, contractId } = await seedTwoContracts();
      const p = await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'a' });

      // Same contract, same amount/date as itself — must exclude its own row.
      const again = await assignPaymentToContract(db, orgId, p.id, [propertyId], contractId);
      expect(again.contractId).toBe(contractId);
      await client.close();
    });
  });

  describe('updatePayment duplicate detection', () => {
    it('refuses editing amount into a collision, but not editing only note', async () => {
      const { db, client, orgId, propertyId, contractId } = await seedTwoContracts();
      await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, amount: 5_000_00, externalId: 'a' });
      const p = await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, amount: 3_000_00, externalId: 'b' });

      // Editing only note/description must not pay for a query and must not fail.
      const noted = await updatePayment(db, orgId, p.id, [propertyId], { note: 'poznámka' });
      expect(noted.note).toBe('poznámka');

      await expect(updatePayment(db, orgId, p.id, [propertyId], { amount: 5_000_00 }))
        .rejects.toMatchObject({ kind: 'conflict' });

      const forced = await updatePayment(db, orgId, p.id, [propertyId], { amount: 5_000_00, allowDuplicate: true });
      expect(forced.amount).toBe(5_000_00);
      await client.close();
    });

    it('refuses editing paidAt into a collision', async () => {
      const { db, client, orgId, propertyId, contractId } = await seedTwoContracts();
      await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, paidAt: '2026-08-01', externalId: 'a' });
      const p = await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, paidAt: '2026-08-02', externalId: 'b' });

      await expect(updatePayment(db, orgId, p.id, [propertyId], { paidAt: '2026-08-01' }))
        .rejects.toMatchObject({ kind: 'conflict' });
      await client.close();
    });

    it('skips the check when the merged contractId is null (unassigned payment)', async () => {
      const { db, client, orgId, propertyId } = await seedTwoContracts();
      const p = await recordPayment(db, orgId, [propertyId], { contractId: null, ...MONEY, externalId: 'a' });
      await recordPayment(db, orgId, [propertyId], { contractId: null, ...MONEY, externalId: 'b' });

      // Editing amount on an unassigned payment: no contract to fingerprint
      // against, so this must not throw even though another unassigned row
      // shares the same amount/date. The patch must be a REAL change
      // (MONEY.amount + 1) — patching the amount back to its own current
      // value would make isNoOp true and skip the guard block before the
      // `mergedContractId !== null` branch this test claims to exercise is
      // ever reached, so the test would pass whether or not that branch works.
      const edited = await updatePayment(db, orgId, p.id, [propertyId], { amount: MONEY.amount + 1 });
      expect(edited.id).toBe(p.id);
      expect(edited.amount).toBe(MONEY.amount + 1);
      await client.close();
    });

    // THE self-exclusion regression test: without `excludeId`, this no-op patch
    // would find the row's OWN fingerprint and refuse itself, making every edit
    // impossible. If `excludeId` is ever dropped from findPaymentByFingerprint
    // (or not threaded through here), this test fails.
    it('does not self-conflict on a no-op patch setting amount to the value it already has', async () => {
      const { db, client, orgId, propertyId, contractId } = await seedTwoContracts();
      const p = await recordPayment(db, orgId, [propertyId], { contractId, ...MONEY, externalId: 'a' });

      const result = await updatePayment(db, orgId, p.id, [propertyId], { amount: MONEY.amount });
      expect(result.amount).toBe(MONEY.amount);
      await client.close();
    });
  });

  // The sticky false conflict: once two payments legitimately coexist on one
  // contract with the same amount/date (via `allowDuplicate`), a no-op action
  // on EITHER one must not re-trigger the guard — self-exclusion alone isn't
  // enough, because the OTHER sibling is a real fingerprint match and isn't
  // excluded. The fix is a no-op short-circuit that runs BEFORE the fingerprint
  // query, not just a suppressed throw after it.
  describe('no-op short-circuit on a legitimately coexisting pair', () => {
    async function seedCoexistingPair() {
      const base = await seed();
      const a = await recordPayment(base.db, base.orgId, [base.propertyId], { contractId: base.contractId, ...MONEY, externalId: 'a' });
      const b = await recordPayment(base.db, base.orgId, [base.propertyId], {
        contractId: base.contractId, ...MONEY, externalId: 'b', allowDuplicate: true,
      });
      return { ...base, a, b };
    }

    it('assigning either sibling to the contract it is already on succeeds (the reported bug)', async () => {
      const { db, client, orgId, propertyId, contractId, a, b } = await seedCoexistingPair();

      const reassignedA = await assignPaymentToContract(db, orgId, a.id, [propertyId], contractId);
      expect(reassignedA.contractId).toBe(contractId);

      const reassignedB = await assignPaymentToContract(db, orgId, b.id, [propertyId], contractId);
      expect(reassignedB.contractId).toBe(contractId);

      await client.close();
    });

    it('updating either sibling with its own unchanged amount succeeds', async () => {
      const { db, client, orgId, propertyId, a, b } = await seedCoexistingPair();

      const updatedA = await updatePayment(db, orgId, a.id, [propertyId], { amount: a.amount });
      expect(updatedA.amount).toBe(a.amount);

      const updatedB = await updatePayment(db, orgId, b.id, [propertyId], { amount: b.amount });
      expect(updatedB.amount).toBe(b.amount);

      await client.close();
    });

    // Proves the no-op short-circuit did NOT disable the guard: a genuinely
    // different amount that collides with a THIRD payment must still conflict.
    it('updating a sibling to a genuinely different amount that collides with a third payment still conflicts', async () => {
      const { db, client, orgId, propertyId, contractId, a } = await seedCoexistingPair();
      const third = await recordPayment(db, orgId, [propertyId], {
        contractId, ...MONEY, amount: 1_000_00, externalId: 'c',
      });

      await expect(updatePayment(db, orgId, a.id, [propertyId], { amount: third.amount }))
        .rejects.toMatchObject({ kind: 'conflict' });

      await client.close();
    });
  });
});
