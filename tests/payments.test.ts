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

  it('returns contract names, and nulls for an unassigned payment', async () => {
    const { client, app, cookie, contract: c } = await bootstrap();

    await app.request('/api/payments', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contractId: c.id, amount: 1200000, paidAt: '2024-10-01', source: 'manual' }),
    });
    await app.request('/api/payments', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contractId: null, amount: 500000, paidAt: '2024-10-02', source: 'manual' }),
    });

    const res = await app.request('/api/payments', { headers: { cookie } });
    const payments = (await res.json() as any).payments as any[];

    const assigned = payments.find(p => p.contractId === c.id);
    // bootstrap() in this file creates the property as 'KP' and the tenant as 'SB'.
    expect(assigned.propertyName).toBe('KP');
    expect(assigned.tenantName).toBe('SB');

    const unassigned = payments.find(p => p.contractId === null);
    expect(unassigned).toBeDefined();               // leftJoin must not drop it
    expect(unassigned.propertyName).toBeNull();
    expect(unassigned.tenantName).toBeNull();

    await client.close();
  });

  it('every write endpoint returns real names or null, never undefined (regression: raw .returning() rows cannot carry joined names)', async () => {
    const { client, app, cookie, contract: c } = await bootstrap();
    try {
      // POST /api/payments — created assigned to a contract
      const createAssigned = await app.request('/api/payments', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ contractId: c.id, amount: 100000, paidAt: '2024-10-01', source: 'manual' }),
      });
      const assignedPayment = (await createAssigned.json() as any).payment;
      // bootstrap() in this file creates the property as 'KP' and the tenant as 'SB'.
      expect(assignedPayment.propertyName).toBe('KP');
      expect(assignedPayment.tenantName).toBe('SB');

      // POST /api/payments — created unassigned (names must be null, not undefined)
      const createUnassigned = await app.request('/api/payments', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ contractId: null, amount: 200000, paidAt: '2024-10-02', source: 'manual' }),
      });
      const unassignedPayment = (await createUnassigned.json() as any).payment;
      expect(unassignedPayment.propertyName).toBeNull();
      expect(unassignedPayment.tenantName).toBeNull();

      // PATCH /api/payments/:id/assign
      const assignRes = await app.request(`/api/payments/${unassignedPayment.id}/assign`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ contractId: c.id }),
      });
      const assignedViaPatch = (await assignRes.json() as any).payment;
      expect(assignedViaPatch.propertyName).toBe('KP');
      expect(assignedViaPatch.tenantName).toBe('SB');

      // PATCH /api/payments/:id (non-contract field, exercises the update+refetch path)
      const updateRes = await app.request(`/api/payments/${assignedViaPatch.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ note: 'hello' }),
      });
      const updatedPayment = (await updateRes.json() as any).payment;
      expect(updatedPayment.propertyName).toBe('KP');
      expect(updatedPayment.tenantName).toBe('SB');

      // POST /api/payments/batch — one assigned, one unassigned
      const batchRes = await app.request('/api/payments/batch', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify([
          { contractId: c.id, amount: 300000, paidAt: '2024-10-03', source: 'manual' },
          { contractId: null, amount: 400000, paidAt: '2024-10-04', source: 'manual' },
        ]),
      });
      const batchBody = await batchRes.json() as any;
      const batchAssigned = batchBody.created.find((p: any) => p.contractId === c.id);
      const batchUnassigned = batchBody.created.find((p: any) => p.contractId === null);
      expect(batchAssigned.propertyName).toBe('KP');
      expect(batchAssigned.tenantName).toBe('SB');
      expect(batchUnassigned.propertyName).toBeNull();
      expect(batchUnassigned.tenantName).toBeNull();
    } finally {
      await client.close();
    }
  });
});
