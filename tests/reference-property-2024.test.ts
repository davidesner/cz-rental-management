import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

describe('<property-name-a> 2024 reference reconciliation', () => {
  it('produces total diff of +693 Kč ±1 Kč', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'esnerda@gmail.com', 'password123', 'David');
    await app.request('/api/organizations', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'David rentals' }),
    });

    // Create property
    const p = (await (await app.request('/api/properties', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: '<property-name-a>', address: 'Praha', reconciliationSkill: 'reference-reconciliation' }),
    })).json() as any).property;

    // Create tenant
    const t = (await (await app.request('/api/tenants', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: '<tenant-name>', accountNumber: '294153028/0300' }),
    })).json() as any).tenant;

    // Create contract starting 2024-09-20
    const ct = (await (await app.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: '2024-09-20', securityDeposit: 6600000 }),
    })).json() as any).contract;

    // Add ContractTerms: rent 33000, service 7000 (haléře = 3,300,000 and 700,000)
    await app.request(`/api/contracts/${ct.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ validFrom: '2024-09-20', baseRent: 3300000, serviceAdvance: 700000, source: 'initial' }),
    });

    // Add ContractUtility electricity 1200/month
    await app.request(`/api/contracts/${ct.id}/utilities`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ kind: 'electricity', validFrom: '2024-09-20', monthlyAdvance: 120000 }),
    });

    // Add PropertyServiceTariff (informational, doesn't drive reconciliation math here)
    await app.request(`/api/properties/${p.id}/tariffs`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2023-11-01', totalSvjAdvance: 888400, deductibleAmount: 187800,
        deductibleNote: 'Fond oprav 1424 + Odměny výbor 110 + Pojištění 85 + Správa 213 + Ostatní režie 46',
      }),
    });

    // Seed payments (plan amounts to match sheet math)
    const paymentBody = [
      { amount: 1510700, paidAt: '2024-09-20', source: 'manual', externalId: 'kp-2024-09', contractId: ct.id, counterparty: 'BOHUS STEFAN', description: 'Prvni mesic' },
      { amount: 4120000, paidAt: '2024-10-10', source: 'bank', externalId: 'kp-2024-10', contractId: ct.id, counterparty: 'BOHUS STEFAN' },
      { amount: 4120000, paidAt: '2024-11-10', source: 'bank', externalId: 'kp-2024-11', contractId: ct.id, counterparty: 'BOHUS STEFAN' },
      { amount: 4120000, paidAt: '2024-12-10', source: 'bank', externalId: 'kp-2024-12', contractId: ct.id, counterparty: 'BOHUS STEFAN' },
    ];
    const batchRes = await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(paymentBody),
    });
    expect(batchRes.status).toBe(201);

    // SVJ services cost statement (proration-adjusted to contract period)
    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: p.id, kind: 'services',
        periodFrom: '2024-09-20', periodTo: '2024-12-31',
        totalAmount: 2999949, adjustmentAmount: -625374,
        adjustmentNote: 'FO portion (1424+110+85+213+46) × 103/365 days = ~6253 Kč',
        documentRef: 'svj-2024.pdf',
      }),
    });

    // Electricity cost statement
    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: p.id, kind: 'electricity',
        periodFrom: '2024-09-20', periodTo: '2024-12-31',
        totalAmount: 316867, adjustmentAmount: 0,
        adjustmentNote: 'Actual electricity for tenant period (solar credits already included in plan)',
      }),
    });

    // Compute reconciliation
    const comp = await app.request(`/api/contracts/${ct.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-09-20', periodTo: '2024-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;

    // Sum all item differences
    const total = rec.items.reduce((s: number, it: any) => s + it.difference, 0);
    // Expected ~+69,258 haléře (+692.58 Kč), tolerance ±100 haléře (±1 Kč)
    expect(total).toBeGreaterThanOrEqual(69200);
    expect(total).toBeLessThanOrEqual(69400);

    // Print breakdown for debugging
    console.log('<property-name-a> 2024 reconciliation breakdown:');
    for (const it of rec.items) {
      console.log(`  ${it.kind}: paid ${(it.paid / 100).toFixed(2)} Kč, cost ${(it.actualCost / 100).toFixed(2)} Kč, diff ${(it.difference / 100).toFixed(2)} Kč`);
    }
    console.log(`  TOTAL: ${(total / 100).toFixed(2)} Kč`);

    await client.close();
  }, 30000);
});
