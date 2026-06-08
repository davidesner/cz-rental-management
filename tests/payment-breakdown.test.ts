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
    // new fields
    expect(typeof oct.dueDate).toBe('string');
    expect(oct.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(oct.appliedPayments)).toBe(true);
    expect(oct.appliedPayments).toHaveLength(1);
    expect(oct.isLate).toBe(false); // paid 5th, due 10th
    expect(oct.maxLateDays).toBe(0);

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

    // Received 82000 in rent-first model with srážka 50000:
    //   effective rent = 330000 − 50000 = 280000, gets all 82000 (deficit 198000)
    //   service & electricity get 0 (full deficits)
    expect(nov.receivedTotal).toBe(82000);
    expect(nov.allocation.baseRentPaid).toBe(82000);
    expect(nov.allocation.servicePaid).toBe(0);
    expect(nov.allocation.utilityPaid.electricity).toBe(0);
    // Deficits: rent 198000 (280000-82000) + service 70000 + electricity 12000 = 280000
    expect(nov.allocation.deficitTotal).toBe(280000);
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

  it('FIFO: late payment lands entirely on the earliest unpaid month (no split)', async () => {
    const { client, app, cookie, contract } = await bootstrap();

    // Pay nothing in October. Pay double-the-rent in November — whole amount goes to October.
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([
        { amount: 824000, paidAt: '2024-11-08', source: 'bank', externalId: 'fifo-double', contractId: contract.id },
      ]),
    });

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-11-30`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    const oct = data.months.find((m: any) => m.month === '2024-10');
    const nov = data.months.find((m: any) => m.month === '2024-11');

    // Whole 824000 lands on October (earliest unpaid). November stays unpaid.
    expect(oct.receivedTotal).toBe(824000);
    expect(oct.allocation.surplus).toBe(412000); // 824000 - 412000 expected
    expect(nov.receivedTotal).toBe(0);

    expect(oct.appliedPayments).toHaveLength(1);
    expect(oct.appliedPayments[0].amount).toBe(824000);
    expect(oct.appliedPayments[0].lateDays).toBeGreaterThan(0);
    expect(oct.isLate).toBe(true);

    expect(nov.appliedPayments).toHaveLength(0);

    await client.close();
  });

  it('due date computation: default contract (current mode, due day 10)', async () => {
    const { client, app, cookie, contract } = await bootstrap();

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months[0];

    // Default: paymentAppliesTo = 'current', paymentDueDay = 10
    // dueDate for 2024-10 should be 2024-10-10
    expect(oct.dueDate).toBe('2024-10-10');

    await client.close();
  });

  it('due date computation: next mode contract (advance payment)', async () => {
    const { client, app, cookie } = await bootstrap();

    // Create a new contract with paymentAppliesTo = 'next', dueDay = 5
    const pRes = await app.request('/api/properties', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Advance Property' }),
    });
    const tRes = await app.request('/api/tenants', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Advance Tenant' }),
    });
    const p = (await pRes.json() as any).property;
    const t = (await tRes.json() as any).tenant;

    const ctRes = await app.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: p.id, tenantId: t.id, startDate: '2024-10-01',
        paymentDueDay: 5, paymentAppliesTo: 'next',
      }),
    });
    expect(ctRes.status).toBe(201);
    const ct = (await ctRes.json() as any).contract;
    expect(ct.paymentDueDay).toBe(5);
    expect(ct.paymentAppliesTo).toBe('next');

    await app.request(`/api/contracts/${ct.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ validFrom: '2024-10-01', baseRent: 300000, serviceAdvance: 50000, source: 'initial' }),
    });

    const res = await app.request(
      `/api/contracts/${ct.id}/payment-breakdown?from=2024-10-01&to=2024-11-30`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months.find((m: any) => m.month === '2024-10');
    const nov = data.months.find((m: any) => m.month === '2024-11');

    // 'next' mode: October rent due in September (prior month) on day 5
    expect(oct.dueDate).toBe('2024-09-05');
    // November rent due in October on day 5
    expect(nov.dueDate).toBe('2024-10-05');

    await client.close();
  });

  it('late detection: payment after due date → isLate=true, maxLateDays correct', async () => {
    const { client, app, cookie, contract } = await bootstrap();

    // Due date for October = 2024-10-10. Pay on 2024-10-20 (10 days late).
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([
        { amount: 412000, paidAt: '2024-10-20', source: 'bank', externalId: 'late-pay', contractId: contract.id },
      ]),
    });

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months[0];

    expect(oct.isLate).toBe(true);
    expect(oct.maxLateDays).toBe(10);
    expect(oct.appliedPayments[0].lateDays).toBe(10);

    await client.close();
  });
});
