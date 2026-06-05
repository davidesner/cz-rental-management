import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

async function setup() {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
  await app.request('/api/organizations', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'O' }),
  });
  const pRes = await app.request('/api/properties', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: '<property-name-a>' }),
  });
  const tRes = await app.request('/api/tenants', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: '<tenant-name>' }),
  });
  const cRes = await app.request('/api/contracts', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      propertyId: (await pRes.json() as any).property.id,
      tenantId: (await tRes.json() as any).tenant.id,
      startDate: '2024-09-20',
    }),
  });
  return { client, app, cookie, contract: (await cRes.json() as any).contract };
}

describe('contract terms (SCD2)', () => {
  it('initial + addendum closes prior row', async () => {
    const { client, app, cookie, contract } = await setup();
    const a = await app.request(`/api/contracts/${contract.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2024-09-20', baseRent: 3300000, serviceAdvance: 700000, source: 'initial',
      }),
    });
    expect(a.status).toBe(201);
    const aRow = (await a.json() as any).terms;
    expect(aRow.validTo).toBeNull();

    const b = await app.request(`/api/contracts/${contract.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2026-01-01', baseRent: 3500000, serviceAdvance: 750000, source: 'change',
      }),
    });
    expect(b.status).toBe(201);

    const list = await app.request(`/api/contracts/${contract.id}/terms`, { headers: { cookie } });
    const rows = (await list.json() as any).terms;
    expect(rows).toHaveLength(2);
    expect(rows[0].validFrom).toBe('2024-09-20');
    expect(rows[0].validTo).toBe('2026-01-01');
    expect(rows[1].validFrom).toBe('2026-01-01');
    expect(rows[1].validTo).toBeNull();
    await client.close();
  });
});
