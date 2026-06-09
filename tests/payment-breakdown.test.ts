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
      }),
    });
    expect(ctRes.status).toBe(201);
    const ct = (await ctRes.json() as any).contract;

    await app.request(`/api/contracts/${ct.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2024-10-01', baseRent: 300000, serviceAdvance: 50000,
        paymentDueDay: 5, paymentAppliesTo: 'next', source: 'initial',
      }),
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

  it('next mode: payment paid in Dec (before periodFrom) matches Jan slot via naturalMonth', async () => {
    // Bug: payment query loaded only [periodFrom, periodTo], so Dec 25 platba
    // (which has naturalMonth = Jan due to 'next' offset) was missing → Jan slot
    // fell back to Jan 18 platba (naturalMonth = Feb), incorrectly marked "late".
    const { client, app, cookie } = await bootstrap();

    const pRes = await app.request('/api/properties', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Adv Prop' }),
    });
    const tRes = await app.request('/api/tenants', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Adv Tenant' }),
    });
    const p = (await pRes.json() as any).property;
    const t = (await tRes.json() as any).tenant;
    const ctRes = await app.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: p.id, tenantId: t.id, startDate: '2024-01-01',
      }),
    });
    const ct = (await ctRes.json() as any).contract;
    await app.request(`/api/contracts/${ct.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2024-01-01', baseRent: 3000000, serviceAdvance: 500000,
        paymentDueDay: 25, paymentAppliesTo: 'next', source: 'initial',
      }),
    });

    // Two payments: Dec 25, 2023 (for Jan slot) + Jan 25, 2024 (for Feb slot)
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([
        { amount: 3500000, paidAt: '2023-12-25', source: 'bank', externalId: 'dec-prev', contractId: ct.id, counterparty: 'X' },
        { amount: 3500000, paidAt: '2024-01-25', source: 'bank', externalId: 'jan', contractId: ct.id, counterparty: 'X' },
      ]),
    });

    const res = await app.request(
      `/api/contracts/${ct.id}/payment-breakdown?from=2024-01-01&to=2024-02-29`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const jan = data.months.find((m: any) => m.month === '2024-01');
    const feb = data.months.find((m: any) => m.month === '2024-02');

    // Jan slot: dueDate Dec 25, 2023; payment paid exactly Dec 25 → not late
    expect(jan.dueDate).toBe('2023-12-25');
    expect(jan.isLate).toBe(false);
    expect(jan.appliedPayments).toHaveLength(1);
    expect(jan.appliedPayments[0].paidAt).toBe('2023-12-25');
    expect(jan.appliedPayments[0].lateDays).toBe(0);

    // Feb slot: dueDate Jan 25, 2024; payment Jan 25 → not late
    expect(feb.dueDate).toBe('2024-01-25');
    expect(feb.isLate).toBe(false);
    expect(feb.appliedPayments).toHaveLength(1);
    expect(feb.appliedPayments[0].paidAt).toBe('2024-01-25');

    await client.close();
  });

  it('temporal payment terms: amendment changes paymentAppliesTo mid-contract', async () => {
    // Setup: contract starts 2024 with paymentAppliesTo='next' (rent for Jan paid 25.Dec),
    // amendment from 2025-01-01 switches to paymentAppliesTo='current' (rent for Jan paid 1.Jan).
    // Dec 25 2024 platba → naturalMonth Jan 2025 (still 'next' for paidAt) → ...
    // But Jan 2025 slot's dueDate is governed by NEW terms = 'current', dueDay 1 → 2025-01-01.
    // Wait — Dec 25 2024 payment is paid under OLD terms ('next'), so naturalMonth = Jan 2025.
    // Jan 2025 slot exists & gets matched. lateness depends on NEW dueDate 2025-01-01 vs paid 2024-12-25 → 7 days early, not late.
    const { client, app, cookie } = await bootstrap();
    const p = (await (await app.request('/api/properties', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Mid' }),
    })).json() as any).property;
    const t = (await (await app.request('/api/tenants', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Mid' }),
    })).json() as any).tenant;
    const ct = (await (await app.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: '2024-01-01' }),
    })).json() as any).contract;

    // Initial terms 2024-01-01: dueDay 25, applies 'next'
    await app.request(`/api/contracts/${ct.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2024-01-01', baseRent: 3000000, serviceAdvance: 500000,
        paymentDueDay: 25, paymentAppliesTo: 'next', source: 'initial',
      }),
    });
    // Amendment 2025-01-01: dueDay 1, applies 'current'
    await app.request(`/api/contracts/${ct.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2025-01-01', baseRent: 3000000, serviceAdvance: 500000,
        paymentDueDay: 1, paymentAppliesTo: 'current', source: 'addendum',
      }),
    });

    // Payments — one per slot to avoid FIFO overflow ambiguity:
    //  - Nov 25 2024 (paid under OLD 'next' valid 2024-11-25 → naturalMonth Dec 2024)
    //  - Dec 25 2024 (paid under OLD 'next' → naturalMonth Jan 2025)
    //  - Feb 1  2025 (paid under NEW 'current' → naturalMonth Feb 2025)
    // Slots:
    //  - Dec 2024 dueDate 2024-11-25 (OLD); Nov 25 platba matchne → lateness 0
    //  - Jan 2025 dueDate 2025-01-01 (NEW); Dec 25 platba matchne → 7 days early, not late
    //  - Feb 2025 dueDate 2025-02-01 (NEW); Feb 1 platba matchne → 0 days, not late
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([
        { amount: 3500000, paidAt: '2024-11-25', source: 'bank', externalId: 'nov-pay', contractId: ct.id, counterparty: 'X' },
        { amount: 3500000, paidAt: '2024-12-25', source: 'bank', externalId: 'dec-pay', contractId: ct.id, counterparty: 'X' },
        { amount: 3500000, paidAt: '2025-02-01', source: 'bank', externalId: 'feb-pay', contractId: ct.id, counterparty: 'X' },
      ]),
    });

    const res = await app.request(
      `/api/contracts/${ct.id}/payment-breakdown?from=2024-12-01&to=2025-02-28`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const dec24 = data.months.find((m: any) => m.month === '2024-12');
    const jan25 = data.months.find((m: any) => m.month === '2025-01');
    const feb25 = data.months.find((m: any) => m.month === '2025-02');

    // Dec 2024 slot uses OLD terms (dueDay 25 'next' → due 2024-11-25)
    expect(dec24.dueDate).toBe('2024-11-25');
    expect(dec24.appliedPayments.length).toBe(1);
    expect(dec24.appliedPayments[0].paidAt).toBe('2024-11-25');
    expect(dec24.isLate).toBe(false);

    // Jan 2025 slot uses NEW terms (dueDay 1 'current' → due 2025-01-01)
    expect(jan25.dueDate).toBe('2025-01-01');
    expect(jan25.appliedPayments.length).toBe(1);
    expect(jan25.appliedPayments[0].paidAt).toBe('2024-12-25');
    expect(jan25.isLate).toBe(false);

    // Feb 2025 uses NEW
    expect(feb25.dueDate).toBe('2025-02-01');
    expect(feb25.appliedPayments.length).toBe(1);
    expect(feb25.appliedPayments[0].paidAt).toBe('2025-02-01');
    expect(feb25.isLate).toBe(false);

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
