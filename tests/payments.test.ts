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
  const ct = (await (await app.request('/api/contracts', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: '2024-09-20' }) })).json() as any).contract;
  return { client, app, cookie, contract: ct };
}

describe('payments REST', () => {
  it('create + list + get + assign + delete', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    const create = await app.request('/api/payments', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ amount: 4120000, paidAt: '2024-10-10', source: 'bank', externalId: 'tx-1', counterparty: 'BOHUS STEFAN' }),
    });
    expect(create.status).toBe(201);
    const p = (await create.json() as any).payment;
    expect(p.contractId).toBeNull();

    const assign = await app.request(`/api/payments/${p.id}/assign`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contractId: contract.id }),
    });
    expect((await assign.json() as any).payment.contractId).toBe(contract.id);

    const inbox = await app.request('/api/payments?unassigned=true', { headers: { cookie } });
    expect((await inbox.json() as any).payments).toHaveLength(0);

    const del = await app.request(`/api/payments/${p.id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(204);
    await client.close();
  });

  it('idempotent batch by externalId', async () => {
    const { client, app, cookie } = await bootstrap();
    const body = [
      { amount: 4120000, paidAt: '2024-10-10', source: 'bank', externalId: 'tx-A' },
      { amount: 4120000, paidAt: '2024-11-10', source: 'bank', externalId: 'tx-B' },
    ];
    const first = await app.request('/api/payments/batch', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
    const r1 = await first.json() as any;
    expect(r1.created).toHaveLength(2);
    expect(r1.existing).toHaveLength(0);
    const second = await app.request('/api/payments/batch', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
    const r2 = await second.json() as any;
    expect(r2.created).toHaveLength(0);
    expect(r2.existing).toHaveLength(2);
    const list = await app.request('/api/payments', { headers: { cookie } });
    expect((await list.json() as any).payments).toHaveLength(2);
    await client.close();
  });
});
