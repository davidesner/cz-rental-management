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
  const ct = (await (await app.request('/api/contracts', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: '2024-10-01' }) })).json() as any).contract;
  // Add terms: 3300 Kč rent + 700 Kč service
  await app.request(`/api/contracts/${ct.id}/terms`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ validFrom: '2024-10-01', baseRent: 330000, serviceAdvance: 70000, source: 'initial' }),
  });
  // Add electricity: 120 Kč/month
  await app.request(`/api/contracts/${ct.id}/utilities`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ kind: 'electricity', validFrom: '2024-10-01', monthlyAdvance: 12000 }),
  });
  return { client, app, cookie, contract: ct };
}

describe('payment-breakdown endpoint', () => {
  it('no payments + no reductions → expected populated, received 0, deficit = expectedTotal', async () => {
    const { client, app, cookie, contract } = await bootstrap();

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-11-30`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.months).toHaveLength(2);
    expect(data.rentReductions).toHaveLength(0);

    const oct = data.months.find((m: any) => m.month === '2024-10');
    expect(oct).toBeDefined();
    // baseRent 330000 + service 70000 + electricity 12000 = 412000
    expect(oct.expected.total).toBe(412000);
    expect(oct.expected.baseRent).toBe(330000);
    expect(oct.expected.serviceAdvance).toBe(70000);
    expect(oct.expected.utilities.electricity).toBe(12000);
    expect(oct.rentReduction).toBe(0);
    expect(oct.effectiveExpected).toBe(412000);
    expect(oct.receivedTotal).toBe(0);
    // deficit should match expected total since nothing paid
    expect(oct.allocation.deficitTotal).toBe(412000);
    expect(oct.allocation.surplus).toBe(0);
    expect(oct.paymentIds).toHaveLength(0);

    await client.close();
  });

  it('full payment → no deficit, no surplus', async () => {
    const { client, app, cookie, contract } = await bootstrap();

    // Pay exact amount for October
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([
        { amount: 412000, paidAt: '2024-10-05', source: 'bank', externalId: 'full-oct', contractId: contract.id },
      ]),
    });

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    const oct = data.months[0];
    expect(oct.receivedTotal).toBe(412000);
    expect(oct.allocation.deficitTotal).toBe(0);
    expect(oct.allocation.surplus).toBe(0);
    expect(oct.paymentIds).toHaveLength(1);

    await client.close();
  });

  it('rent reduction + partial payment → reduction reflected, allocation deficit lands on rent', async () => {
    const { client, app, cookie, contract } = await bootstrap();

    // Add a rent reduction of 50 Kč (5000 haléřů) for November
    const rr = await app.request(`/api/contracts/${contract.id}/rent-reductions`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ forMonth: '2024-11-01', amount: 50000, reason: 'Tenant fixed radiator' }),
    });
    expect(rr.status).toBe(201);

    // Tenant pays electricity + service only in November (12000 + 70000 = 82000)
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([
        { amount: 82000, paidAt: '2024-11-10', source: 'bank', externalId: 'partial-nov', contractId: contract.id },
      ]),
    });

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-11-01&to=2024-11-30`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    const nov = data.months.find((m: any) => m.month === '2024-11');
    expect(nov).toBeDefined();

    // expectedTotal = 330000 + 70000 + 12000 = 412000
    expect(nov.expected.total).toBe(412000);
    // reduction applied
    expect(nov.rentReduction).toBe(50000);
    expect(nov.effectiveExpected).toBe(362000); // 412000 - 50000

    // Received 82000 in rent-first model: rent gets all 82000, advances get 0
    expect(nov.receivedTotal).toBe(82000);
    expect(nov.allocation.baseRentPaid).toBe(82000);
    expect(nov.allocation.servicePaid).toBe(0);
    expect(nov.allocation.utilityPaid.electricity).toBe(0);
    // Deficits: rent 248000 (330000-82000) + service 70000 + electricity 12000 = 330000
    expect(nov.allocation.deficitTotal).toBe(330000);
    expect(nov.allocation.surplus).toBe(0);

    // rentReductions array included
    expect(data.rentReductions).toHaveLength(1);
    expect(data.rentReductions[0].amount).toBe(50000);
    expect(data.rentReductions[0].reason).toBe('Tenant fixed radiator');

    await client.close();
  });

  it('missing from/to params → 400', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    const res = await app.request(`/api/contracts/${contract.id}/payment-breakdown`, { headers: { cookie } });
    expect(res.status).toBe(400);
    await client.close();
  });
});
