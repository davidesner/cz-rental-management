import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

async function setup() {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
  await app.request('/api/organizations', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'O' }) });
  const p = (await (await app.request('/api/properties', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'KP' }) })).json() as any).property;
  const t = (await (await app.request('/api/tenants', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'SB' }) })).json() as any).tenant;
  const ct = (await (await app.request('/api/contracts', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: '2024-09-20' }) })).json() as any).contract;
  return { client, app, cookie, contract: ct };
}

describe('contract utilities (SCD2)', () => {
  it('per-kind open row, separate windows per kind', async () => {
    const { client, app, cookie, contract } = await setup();
    await app.request(`/api/contracts/${contract.id}/utilities`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ kind: 'electricity', validFrom: '2024-09-20', monthlyAdvance: 120000 }),
    });
    await app.request(`/api/contracts/${contract.id}/utilities`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ kind: 'internet', validFrom: '2024-10-01', monthlyAdvance: 50000 }),
    });
    // bump electricity advance — should close prior electricity row only
    await app.request(`/api/contracts/${contract.id}/utilities`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ kind: 'electricity', validFrom: '2025-01-01', monthlyAdvance: 130000 }),
    });
    const list = await app.request(`/api/contracts/${contract.id}/utilities`, { headers: { cookie } });
    const rows = (await list.json() as any).utilities;
    expect(rows).toHaveLength(3);
    const el = rows.filter((r: any) => r.kind === 'electricity');
    expect(el[0].validTo).toBe('2025-01-01');
    expect(el[1].validTo).toBeNull();
    const internet = rows.filter((r: any) => r.kind === 'internet');
    expect(internet[0].validTo).toBeNull();
    await client.close();
  });
});
