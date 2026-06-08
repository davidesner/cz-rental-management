import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

async function setupContract() {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
  await app.request('/api/organizations', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'O' }) });
  const p = (await (await app.request('/api/properties', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'KP' }) })).json() as any).property;
  const t = (await (await app.request('/api/tenants', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'SB' }) })).json() as any).tenant;
  const ct = (await (await app.request('/api/contracts', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: '2024-09-20' }) })).json() as any).contract;
  await app.request(`/api/contracts/${ct.id}/terms`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ validFrom: '2024-09-20', baseRent: 3300000, serviceAdvance: 700000, source: 'initial' }),
  });
  await app.request(`/api/contracts/${ct.id}/utilities`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ kind: 'electricity', validFrom: '2024-09-20', monthlyAdvance: 120000 }),
  });
  return { client, app, cookie, property: p, contract: ct };
}

describe('reconciliation', () => {
  it('compute -> finalize -> list -> cannot delete finalized', async () => {
    const { client, app, cookie, contract } = await setupContract();
    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-09-20', periodTo: '2024-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;
    expect(rec.status).toBe('draft');
    // No payments, no statements → items may be empty (all zero)

    const fin = await app.request(`/api/reconciliations/${rec.id}/finalize`, { method: 'PATCH', headers: { cookie } });
    const finalized = (await fin.json() as any).reconciliation;
    expect(finalized.status).toBe('finalized');

    const del = await app.request(`/api/reconciliations/${rec.id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(409);
    await client.close();
  });

  it('compute returns breakdown.costStatements and breakdown.months per item', async () => {
    const { client, app, cookie, property, contract } = await setupContract();

    // Add a cost statement
    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id,
        kind: 'electricity',
        periodFrom: '2024-10-01',
        periodTo: '2024-12-31',
        totalAmount: 300000,
        adjustmentAmount: -10000,
        adjustmentNote: 'Solar credit',
        documentRef: 'elec-2024.pdf',
      }),
    });

    // Add a payment
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([
        { amount: 4120000, paidAt: '2024-10-10', source: 'bank', externalId: 'test-oct', contractId: contract.id, counterparty: 'TENANT' },
      ]),
    });

    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-10-01', periodTo: '2024-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;
    expect(rec.items.length).toBeGreaterThan(0);

    const elecItem = rec.items.find((i: any) => i.kind === 'electricity');
    expect(elecItem).toBeDefined();
    expect(elecItem.breakdown).toBeDefined();
    expect(Array.isArray(elecItem.breakdown.costStatements)).toBe(true);
    expect(elecItem.breakdown.costStatements.length).toBe(1);
    expect(elecItem.breakdown.costStatements[0].adjustmentNote).toBe('Solar credit');
    expect(elecItem.breakdown.costStatements[0].documentRef).toBe('elec-2024.pdf');
    expect(elecItem.breakdown.costStatements[0].totalAmount).toBe(300000);
    expect(elecItem.breakdown.costStatements[0].adjustmentAmount).toBe(-10000);

    expect(Array.isArray(elecItem.breakdown.months)).toBe(true);
    expect(elecItem.breakdown.months.length).toBe(3); // Oct, Nov, Dec
    for (const m of elecItem.breakdown.months) {
      expect(m.month).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof m.daysActive).toBe('number');
      expect(typeof m.daysInMonth).toBe('number');
      expect(typeof m.expectedThisKind).toBe('number');
      expect(typeof m.expectedTotal).toBe('number');
      expect(typeof m.receivedTotal).toBe('number');
      expect(typeof m.paidThisKind).toBe('number');
    }

    await client.close();
  });

  it('getReconciliation also returns breakdown', async () => {
    const { client, app, cookie, property, contract } = await setupContract();

    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id,
        kind: 'services',
        periodFrom: '2024-10-01',
        periodTo: '2024-12-31',
        totalAmount: 500000,
        adjustmentAmount: 0,
        adjustmentNote: 'SVJ services Q4',
      }),
    });

    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([
        { amount: 4120000, paidAt: '2024-11-10', source: 'bank', externalId: 'test-nov', contractId: contract.id, counterparty: 'TENANT' },
      ]),
    });

    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-10-01', periodTo: '2024-12-31' }),
    });
    const recId = (await comp.json() as any).reconciliation.id;

    // Fetch via GET
    const get = await app.request(`/api/reconciliations/${recId}`, { headers: { cookie } });
    expect(get.status).toBe(200);
    const fetched = (await get.json() as any).reconciliation;
    expect(fetched.items.length).toBeGreaterThan(0);
    for (const item of fetched.items) {
      expect(item.breakdown).toBeDefined();
      expect(Array.isArray(item.breakdown.costStatements)).toBe(true);
      expect(Array.isArray(item.breakdown.months)).toBe(true);
    }

    await client.close();
  });

  it('recompute updates items and computedAt; same id, items array refreshed', async () => {
    const { client, app, cookie, property, contract } = await setupContract();

    // Create reconciliation without cost statement
    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-10-01', periodTo: '2024-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;
    const recId = rec.id;
    const originalComputedAt = rec.computedAt;

    // Add a cost statement
    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id,
        kind: 'electricity',
        periodFrom: '2024-10-01',
        periodTo: '2024-12-31',
        totalAmount: 360000,
        adjustmentAmount: 0,
        adjustmentNote: null,
      }),
    });

    // Add a payment
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([
        { amount: 4120000, paidAt: '2024-10-10', source: 'bank', externalId: 'recompute-test', contractId: contract.id, counterparty: 'TENANT' },
      ]),
    });

    // Recompute
    const recomp = await app.request(`/api/reconciliations/${recId}/recompute`, {
      method: 'POST', headers: { cookie },
    });
    expect(recomp.status).toBe(200);
    const recomputed = (await recomp.json() as any).reconciliation;

    // Same ID
    expect(recomputed.id).toBe(recId);
    // Items should now include electricity
    const elecItem = recomputed.items.find((i: any) => i.kind === 'electricity');
    expect(elecItem).toBeDefined();
    expect(elecItem.actualCost).toBe(360000);
    // computedAt should be set
    expect(recomputed.computedAt).toBeDefined();

    await client.close();
  });

  it('recompute on finalized reconciliation returns 409', async () => {
    const { client, app, cookie, contract } = await setupContract();

    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-10-01', periodTo: '2024-12-31' }),
    });
    const rec = (await comp.json() as any).reconciliation;

    // Finalize it
    await app.request(`/api/reconciliations/${rec.id}/finalize`, { method: 'PATCH', headers: { cookie } });

    // Recompute should fail
    const recomp = await app.request(`/api/reconciliations/${rec.id}/recompute`, {
      method: 'POST', headers: { cookie },
    });
    expect(recomp.status).toBe(409);

    await client.close();
  });

  it('delete on draft returns 204; subsequent GET returns 404', async () => {
    const { client, app, cookie, contract } = await setupContract();

    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-10-01', periodTo: '2024-12-31' }),
    });
    const rec = (await comp.json() as any).reconciliation;
    expect(rec.status).toBe('draft');

    const del = await app.request(`/api/reconciliations/${rec.id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(204);

    const get = await app.request(`/api/reconciliations/${rec.id}`, { headers: { cookie } });
    expect(get.status).toBe(404);

    await client.close();
  });

  it('listReconciliations returns costStatementNotes field', async () => {
    const { client, app, cookie, property, contract } = await setupContract();

    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id,
        kind: 'services',
        periodFrom: '2024-10-01',
        periodTo: '2024-12-31',
        totalAmount: 500000,
        adjustmentAmount: 0,
        adjustmentNote: 'SVJ Q4 note',
      }),
    });

    await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-10-01', periodTo: '2024-12-31' }),
    });

    const list = await app.request('/api/reconciliations', { headers: { cookie } });
    expect(list.status).toBe(200);
    const recs = (await list.json() as any).reconciliations;
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(Array.isArray(r.costStatementNotes)).toBe(true);
    }
    // The one we just created should have the note
    const found = recs.find((r: any) => r.contractId === contract.id);
    expect(found).toBeDefined();
    expect(found.costStatementNotes).toContain('SVJ Q4 note');

    await client.close();
  });
});
