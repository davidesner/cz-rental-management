import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

async function bootstrap() {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
  await app.request('/api/organizations', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'O' }) });
  const p = (await (await app.request('/api/properties', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'KP' }) })).json() as any).property;
  const t = (await (await app.request('/api/tenants', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'SB' }) })).json() as any).tenant;
  const ct = (await (await app.request('/api/contracts', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: '2024-09-01' }) })).json() as any).contract;
  return { client, app, cookie, contract: ct };
}

describe('rent-reductions REST', () => {
  it('create, list, delete smoke test', async () => {
    const { client, app, cookie, contract } = await bootstrap();

    // Create a rent reduction
    const create = await app.request(`/api/contracts/${contract.id}/rent-reductions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ forMonth: '2024-11-01', amount: 50000, reason: 'Tenant fixed leaky pipe' }),
    });
    expect(create.status).toBe(201);
    const { rentReduction } = await create.json() as any;
    expect(rentReduction.id).toBeDefined();
    expect(rentReduction.forMonth).toBe('2024-11-01');
    expect(rentReduction.amount).toBe(50000);
    expect(rentReduction.reason).toBe('Tenant fixed leaky pipe');
    expect(rentReduction.contractId).toBe(contract.id);

    // Normalises mid-month date to first of month
    const create2 = await app.request(`/api/contracts/${contract.id}/rent-reductions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ forMonth: '2024-10-15', amount: 10000, reason: null }),
    });
    expect(create2.status).toBe(201);
    const r2 = (await create2.json() as any).rentReduction;
    expect(r2.forMonth).toBe('2024-10-01');

    // List
    const list = await app.request(`/api/contracts/${contract.id}/rent-reductions`, { headers: { cookie } });
    expect(list.status).toBe(200);
    const { rentReductions } = await list.json() as any;
    expect(rentReductions).toHaveLength(2);

    // Cannot create duplicate for same month
    const dup = await app.request(`/api/contracts/${contract.id}/rent-reductions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ forMonth: '2024-11-05', amount: 5000 }),
    });
    expect(dup.status).toBeGreaterThanOrEqual(400);

    // Delete one
    const del = await app.request(`/api/contracts/${contract.id}/rent-reductions/${rentReduction.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(del.status).toBe(204);

    // List now has 1
    const list2 = await app.request(`/api/contracts/${contract.id}/rent-reductions`, { headers: { cookie } });
    expect((await list2.json() as any).rentReductions).toHaveLength(1);

    // Delete non-existent → 404
    const del404 = await app.request(`/api/contracts/${contract.id}/rent-reductions/nonexistent`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(del404.status).toBe(404);

    await client.close();
  });
});
