import { describe, it, expect, beforeEach } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { freshDb } from './helpers/db.js';
import { organization, property, tenant, contract } from '../core/db/schema.js';
import { computePairingHealth, upsertPaymentRule } from '../core/services/payment-rule.js';

const RULE = { active: true } as const;
const okIntegration = { active: true, lastSyncStatus: 'ok' as const, lastSyncError: null, lastSyncAt: new Date('2026-08-20T05:00:00Z') };

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

describe('computePairingHealth', () => {
  it('is nenastaveno with no integration', () => {
    expect(computePairingHealth(RULE, []).state).toBe('nenastaveno');
  });

  it('is nenastaveno with no rule', () => {
    expect(computePairingHealth(null, [okIntegration]).state).toBe('nenastaveno');
  });

  it('is nenastaveno when the rule is switched off', () => {
    expect(computePairingHealth({ active: false }, [okIntegration]).state).toBe('nenastaveno');
  });

  it('is nenastaveno when every integration is inactive', () => {
    expect(computePairingHealth(RULE, [{ ...okIntegration, active: false }]).state).toBe('nenastaveno');
  });

  it('is ok when the last sync was clean', () => {
    const h = computePairingHealth(RULE, [okIntegration]);
    expect(h.state).toBe('ok');
    expect(h.lastSyncAt).toEqual(okIntegration.lastSyncAt);
  });

  it('is ok before the first sync has run', () => {
    expect(computePairingHealth(RULE, [{ active: true, lastSyncStatus: null, lastSyncError: null, lastSyncAt: null }]).state).toBe('ok');
  });

  it('is chyba and surfaces the error when a sync failed', () => {
    const h = computePairingHealth(RULE, [{ ...okIntegration, lastSyncStatus: 'error', lastSyncError: 'AUTHENTICATIONFAILED' }]);
    expect(h.state).toBe('chyba');
    expect(h.message).toBe('AUTHENTICATIONFAILED');
  });

  it('reports chyba if ANY active integration is failing', () => {
    const h = computePairingHealth(RULE, [okIntegration, { ...okIntegration, lastSyncStatus: 'error', lastSyncError: 'boom' }]);
    expect(h.state).toBe('chyba');
  });

  it('ignores a failing INACTIVE integration', () => {
    const h = computePairingHealth(RULE, [okIntegration, { active: false, lastSyncStatus: 'error', lastSyncError: 'boom', lastSyncAt: null }]);
    expect(h.state).toBe('ok');
  });
});

describe('upsertPaymentRule with blank-to-null normalization', () => {
  it('stores vs as null when submitted as blank string with whitespace', async () => {
    const { db, client, orgId, propertyId, contractId } = await seed();
    const rule = await upsertPaymentRule(
      db,
      orgId,
      contractId,
      [propertyId],
      { vs: '   ', amountFrom: 100, amountTo: 500 },
    );
    expect(rule.vs).toBeNull();
    expect(rule.amountFrom).toBe(100);
    expect(rule.amountTo).toBe(500);
    await client.close();
  });

  it('still rejects vs when submitted as all zeros', async () => {
    const { db, client, orgId, propertyId, contractId } = await seed();
    const promise = upsertPaymentRule(
      db,
      orgId,
      contractId,
      [propertyId],
      { vs: '000', amountFrom: 100, amountTo: 500 },
    );
    await expect(promise).rejects.toMatchObject({
      kind: 'validation',
    });
    await client.close();
  });
});
