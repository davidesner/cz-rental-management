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
    // No payments, no statements → all items zero or no items

    const fin = await app.request(`/api/reconciliations/${rec.id}/finalize`, { method: 'PATCH', headers: { cookie } });
    const finalized = (await fin.json() as any).reconciliation;
    expect(finalized.status).toBe('finalized');

    const del = await app.request(`/api/reconciliations/${rec.id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(409);
    await client.close();
  });
});
