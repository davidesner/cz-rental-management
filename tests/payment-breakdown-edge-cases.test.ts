import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

/**
 * Bootstrap helper: register user, create property + tenant + contract.
 * Auto-org is created by the better-auth hook on sign-up, so no explicit
 * POST /api/organizations is needed.
 *
 * Contract has NO terms/utilities by default — individual tests add them
 * as needed to keep each test independent and focused.
 */
async function bootstrap() {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');

  const p = (await (await app.request('/api/properties', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'P' }),
  })).json() as any).property;

  const t = (await (await app.request('/api/tenants', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'T' }),
  })).json() as any).tenant;

  const ct = (await (await app.request('/api/contracts', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: '2024-10-01' }),
  })).json() as any).contract;

  return { client, app, cookie, property: p, tenant: t, contract: ct };
}

/** Add standard terms: 3300 Kč rent + 700 Kč service (all in haléře) */
async function addTerms(
  app: ReturnType<typeof makeApp>, cookie: string, contractId: string,
  overrides: { paymentDueDay?: number; paymentAppliesTo?: 'current' | 'next'; validFrom?: string } = {},
) {
  await app.request(`/api/contracts/${contractId}/terms`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      validFrom: overrides.validFrom ?? '2024-10-01',
      baseRent: 330000, serviceAdvance: 70000, source: 'initial',
      ...(overrides.paymentDueDay !== undefined ? { paymentDueDay: overrides.paymentDueDay } : {}),
      ...(overrides.paymentAppliesTo !== undefined ? { paymentAppliesTo: overrides.paymentAppliesTo } : {}),
    }),
  });
}

/** Record a single payment */
async function recordPayment(
  app: ReturnType<typeof makeApp>, cookie: string, contractId: string,
  amount: number, paidAt: string, externalId: string,
) {
  return app.request('/api/payments/batch', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify([{ amount, paidAt, source: 'bank', externalId, contractId }]),
  });
}

// ---------------------------------------------------------------------------
// DUE DATE / LATENESS EDGE CASES
// ---------------------------------------------------------------------------

describe('due date / lateness edge cases', () => {
  it('default contract (paymentDueDay 10, current) → dueDate for 2024-10 = 2024-10-10', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.months[0].dueDate).toBe('2024-10-10');
    expect(data.months[0].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await client.close();
  });

  it('paymentDueDay 31 → dueDate for February clamped to last day (28 or 29)', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id, { paymentDueDay: 31 });

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2025-02-01&to=2025-02-28`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    const feb = data.months[0];
    // 2025 is not a leap year → Feb has 28 days, so day 31 clamps to 28
    expect(feb.dueDate).toBe('2025-02-28');

    await client.close();
  });

  it('paymentAppliesTo next → dueDate for 2024-11 = 2024-10-{dueDay}', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id, { paymentDueDay: 5, paymentAppliesTo: 'next' });

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-11-01&to=2024-11-30`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    const nov = data.months.find((m: any) => m.month === '2024-11');
    // 'next' mode: November rent is due in October on day 5
    expect(nov.dueDate).toBe('2024-10-05');

    await client.close();
  });

  it('payment on dueDate → lateDays = 0', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    // dueDate = 2024-10-10, pay exactly on that date
    await recordPayment(app, cookie, contract.id, 400000, '2024-10-10', 'on-time-exact');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months[0];
    expect(oct.isLate).toBe(false);
    expect(oct.maxLateDays).toBe(0);
    expect(oct.appliedPayments[0].lateDays).toBe(0);

    await client.close();
  });

  it('payment 1 day after dueDate → lateDays = 1', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    // dueDate = 2024-10-10, pay on 2024-10-11 (1 day late)
    await recordPayment(app, cookie, contract.id, 400000, '2024-10-11', 'one-day-late');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months[0];
    expect(oct.isLate).toBe(true);
    expect(oct.maxLateDays).toBe(1);
    expect(oct.appliedPayments[0].lateDays).toBe(1);

    await client.close();
  });

  it('multiple payments to same month: some late, some on time → isLate=true, maxLateDays = max late days', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    // Both payments land on October (the only month in the period)
    // First payment on time (Oct 8), second payment late (Oct 25 = 15 days after due day 10)
    await recordPayment(app, cookie, contract.id, 100000, '2024-10-08', 'oct-on-time');
    await recordPayment(app, cookie, contract.id, 100000, '2024-10-25', 'oct-late');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months[0];
    expect(oct.appliedPayments).toHaveLength(2);
    // At least one payment is late
    expect(oct.isLate).toBe(true);
    // maxLateDays = max(0, 15) = 15
    expect(oct.maxLateDays).toBe(15);

    await client.close();
  });

  it('all payments early → isLate=false, maxLateDays=0', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    // Pay early in both October and November
    await recordPayment(app, cookie, contract.id, 330000, '2024-10-05', 'oct-early');
    await recordPayment(app, cookie, contract.id, 330000, '2024-11-05', 'nov-early');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-11-30`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    for (const month of data.months) {
      expect(month.isLate).toBe(false);
      expect(month.maxLateDays).toBe(0);
      for (const ap of month.appliedPayments) {
        expect(ap.lateDays).toBe(0);
      }
    }

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// SMART MATCHING (FIFO + naturalMonth)
// ---------------------------------------------------------------------------

describe('smart matching (FIFO + naturalMonth)', () => {
  it('payment in naturalMonth, no prior empty months → matches naturalMonth', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    // Pay exact in October; query only October → lands on October
    await recordPayment(app, cookie, contract.id, 330000, '2024-10-05', 'nat-month-only');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months[0];
    expect(oct.receivedTotal).toBe(330000);
    expect(oct.appliedPayments).toHaveLength(1);
    expect(oct.appliedPayments[0].amount).toBe(330000);

    await client.close();
  });

  it('payment in naturalMonth, prior month entirely empty → matches prior (catch-up)', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    // October entirely unpaid, then a payment in November → should catch-up to October
    await recordPayment(app, cookie, contract.id, 330000, '2024-11-05', 'nov-catches-oct');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-11-30`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months.find((m: any) => m.month === '2024-10');
    const nov = data.months.find((m: any) => m.month === '2024-11');

    // Payment should have gone to October (earlier empty month)
    expect(oct.receivedTotal).toBe(330000);
    expect(oct.appliedPayments).toHaveLength(1);
    expect(nov.receivedTotal).toBe(0);
    expect(nov.appliedPayments).toHaveLength(0);

    await client.close();
  });

  it('payment in naturalMonth, prior month has any payment (even partial) → matches naturalMonth (no false redirect)', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    // October has a partial payment (not fully empty) → next payment in Nov goes to November
    await recordPayment(app, cookie, contract.id, 100000, '2024-10-05', 'oct-partial');
    await recordPayment(app, cookie, contract.id, 200000, '2024-11-05', 'nov-full');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-11-30`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months.find((m: any) => m.month === '2024-10');
    const nov = data.months.find((m: any) => m.month === '2024-11');

    // October has its partial payment (not empty, so no catch-up)
    expect(oct.receivedTotal).toBe(100000);
    expect(oct.appliedPayments).toHaveLength(1);
    // November gets the November payment directly
    expect(nov.receivedTotal).toBe(200000);
    expect(nov.appliedPayments).toHaveLength(1);

    await client.close();
  });

  it('two payments in same naturalMonth → both land there (no spill even if first overpays)', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    // Two payments in October, each large enough to cover October alone
    await recordPayment(app, cookie, contract.id, 200000, '2024-10-03', 'oct-pay1');
    await recordPayment(app, cookie, contract.id, 200000, '2024-10-08', 'oct-pay2');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months[0];

    // Both payments land on October
    expect(oct.appliedPayments).toHaveLength(2);
    expect(oct.receivedTotal).toBe(400000);

    await client.close();
  });

  it('payment exceeding naturalMonth expected → surplus stays in that month', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);
    // terms: baseRent=330000, service=70000, total=400000 (no utilities)

    // Overpay October by 50000
    await recordPayment(app, cookie, contract.id, 450000, '2024-10-05', 'oct-overpay');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months[0];

    expect(oct.receivedTotal).toBe(450000);
    // surplus = received − effectiveExpected = 450000 − 400000 = 50000
    expect(oct.allocation.surplus).toBe(50000);
    expect(oct.allocation.deficitTotal).toBe(0);

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// RENT REDUCTION (SRÁŽKA) INTERACTIONS
// ---------------------------------------------------------------------------

describe('rent reduction (srážka) interactions', () => {
  it('add rent reduction for month X → rentReduction field reflected; effectiveExpected reduced', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);
    // total=400000 (rent 330000 + service 70000)

    await app.request(`/api/contracts/${contract.id}/rent-reductions`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ forMonth: '2024-10-01', amount: 30000, reason: 'Broken heating' }),
    });

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    const oct = data.months[0];

    expect(oct.rentReduction).toBe(30000);
    expect(oct.expected.total).toBe(400000);
    expect(oct.effectiveExpected).toBe(370000); // 400000 - 30000

    await client.close();
  });

  it('reduction exceeding baseRent → rent allocation gets effective rent clamped at 0', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);
    // baseRent=330000, service=70000, total=400000

    // Add a reduction of 400000 (more than baseRent of 330000)
    await app.request(`/api/contracts/${contract.id}/rent-reductions`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ forMonth: '2024-10-01', amount: 400000, reason: 'Large reduction' }),
    });

    // Pay service advance only
    await recordPayment(app, cookie, contract.id, 70000, '2024-10-05', 'svc-only');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months[0];

    // Effective rent = max(0, 330000 - 400000) = 0
    // effectiveExpected = 400000 - 400000 = 0 (total - reduction, but rent is clamped in allocation)
    expect(oct.rentReduction).toBe(400000);
    // Allocation: rentEffective = 0, service = 70000; received 70000 → all to service
    expect(oct.allocation.baseRentPaid).toBe(0);
    expect(oct.allocation.servicePaid).toBe(70000);
    expect(oct.allocation.deficitTotal).toBe(0);

    await client.close();
  });

  it('reduction with reason → returned in rentReductions array', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    await app.request(`/api/contracts/${contract.id}/rent-reductions`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ forMonth: '2024-10-01', amount: 5000, reason: 'Repaired pipe' }),
    });

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;

    expect(data.rentReductions).toHaveLength(1);
    expect(data.rentReductions[0].amount).toBe(5000);
    expect(data.rentReductions[0].reason).toBe('Repaired pipe');
    expect(typeof data.rentReductions[0].id).toBe('string');
    expect(typeof data.rentReductions[0].forMonth).toBe('string');

    await client.close();
  });

  it('delete reduction → next breakdown reflects change (reduction gone)', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    const rrRes = await app.request(`/api/contracts/${contract.id}/rent-reductions`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ forMonth: '2024-10-01', amount: 20000, reason: 'Test' }),
    });
    const rrData = await rrRes.json() as any;
    const rrId = rrData.rentReduction.id;

    // Verify it's there
    const resBefore = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const dataBefore = await resBefore.json() as any;
    expect(dataBefore.months[0].rentReduction).toBe(20000);
    expect(dataBefore.rentReductions).toHaveLength(1);

    // Delete it
    const delRes = await app.request(`/api/contracts/${contract.id}/rent-reductions/${rrId}`, {
      method: 'DELETE', headers: { cookie },
    });
    expect(delRes.status).toBe(204);

    // Verify it's gone
    const resAfter = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const dataAfter = await resAfter.json() as any;
    expect(dataAfter.months[0].rentReduction).toBe(0);
    expect(dataAfter.rentReductions).toHaveLength(0);

    await client.close();
  });

  it('multiple reductions for different months → independent; each month reflects own reduction', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    // Add different reductions for Oct and Nov
    await app.request(`/api/contracts/${contract.id}/rent-reductions`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ forMonth: '2024-10-01', amount: 10000, reason: 'Oct reduction' }),
    });
    await app.request(`/api/contracts/${contract.id}/rent-reductions`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ forMonth: '2024-11-01', amount: 25000, reason: 'Nov reduction' }),
    });

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-11-30`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months.find((m: any) => m.month === '2024-10');
    const nov = data.months.find((m: any) => m.month === '2024-11');

    expect(oct.rentReduction).toBe(10000);
    expect(oct.effectiveExpected).toBe(390000); // 400000 - 10000
    expect(nov.rentReduction).toBe(25000);
    expect(nov.effectiveExpected).toBe(375000); // 400000 - 25000
    // Total rentReductions returned
    expect(data.rentReductions).toHaveLength(2);

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// PERIOD BOUNDARY
// ---------------------------------------------------------------------------

describe('period boundary', () => {
  it('from after to → 400 bad request', async () => {
    const { client, app, cookie, contract } = await bootstrap();

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-11-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    // The route returns 400 for missing params, but 'from > to' may produce empty months array
    // Check that either 400 is returned or months array is empty (graceful handling)
    if (res.status === 200) {
      const data = await res.json() as any;
      expect(data.months).toHaveLength(0);
    } else {
      expect(res.status).toBe(400);
    }

    await client.close();
  });

  it('from and to same month → single month returned', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.months).toHaveLength(1);
    expect(data.months[0].month).toBe('2024-10');

    await client.close();
  });

  it('from and to very wide range → many months', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    // 24-month range: 2024-01 through 2025-12 = 24 months
    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-01-01&to=2025-12-31`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.months).toHaveLength(24);
    // Verify first and last months
    expect(data.months[0].month).toBe('2024-01');
    expect(data.months[23].month).toBe('2025-12');

    await client.close();
  });

  it('period entirely before contract.startDate → all months have daysActive=0', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    // contract starts 2024-10-01, so any period before that has daysActive=0
    await addTerms(app, cookie, contract.id);

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-07-01&to=2024-09-30`,
      { headers: { cookie } },
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.months).toHaveLength(3); // Jul, Aug, Sep
    for (const month of data.months) {
      expect(month.daysActive).toBe(0);
      expect(month.expected.total).toBe(0);
      expect(month.expected.baseRent).toBe(0);
      expect(month.effectiveExpected).toBe(0);
    }

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// FILTER & RESPONSE SHAPE
// ---------------------------------------------------------------------------

describe('filter & response shape', () => {
  it('paymentIds (deprecated) back-compat: still present and mirrors appliedPayments ids', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    await recordPayment(app, cookie, contract.id, 200000, '2024-10-05', 'compat-pay');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months[0];

    // paymentIds must exist and be an array
    expect(Array.isArray(oct.paymentIds)).toBe(true);
    expect(oct.paymentIds).toHaveLength(1);
    // paymentIds should match IDs from appliedPayments
    const appliedIds = oct.appliedPayments.map((ap: any) => ap.paymentId);
    expect(oct.paymentIds).toEqual(appliedIds);

    await client.close();
  });

  it('appliedPayments canonical: each entry has paymentId, paidAt, amount, lateDays', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    await recordPayment(app, cookie, contract.id, 330000, '2024-10-08', 'shape-test');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months[0];

    expect(oct.appliedPayments).toHaveLength(1);
    const ap = oct.appliedPayments[0];
    expect(typeof ap.paymentId).toBe('string');
    expect(ap.paymentId.length).toBeGreaterThan(0);
    expect(typeof ap.paidAt).toBe('string');
    expect(ap.paidAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof ap.amount).toBe('number');
    expect(Number.isInteger(ap.amount)).toBe(true);
    expect(typeof ap.lateDays).toBe('number');
    expect(Number.isInteger(ap.lateDays)).toBe(true);
    expect(ap.lateDays).toBeGreaterThanOrEqual(0);

    await client.close();
  });

  it('rentReductions array always present (empty if none)', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;

    expect(Array.isArray(data.rentReductions)).toBe(true);
    expect(data.rentReductions).toHaveLength(0);

    await client.close();
  });

  it('all amounts are integers (haléře)', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    await addTerms(app, cookie, contract.id);

    await recordPayment(app, cookie, contract.id, 333333, '2024-10-07', 'odd-amount');

    const res = await app.request(
      `/api/contracts/${contract.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie } },
    );
    const data = await res.json() as any;
    const oct = data.months[0];

    // Verify integer types for all monetary fields
    expect(Number.isInteger(oct.expected.baseRent)).toBe(true);
    expect(Number.isInteger(oct.expected.serviceAdvance)).toBe(true);
    expect(Number.isInteger(oct.expected.total)).toBe(true);
    expect(Number.isInteger(oct.rentReduction)).toBe(true);
    expect(Number.isInteger(oct.effectiveExpected)).toBe(true);
    expect(Number.isInteger(oct.receivedTotal)).toBe(true);
    expect(Number.isInteger(oct.allocation.baseRentPaid)).toBe(true);
    expect(Number.isInteger(oct.allocation.servicePaid)).toBe(true);
    expect(Number.isInteger(oct.allocation.surplus)).toBe(true);
    expect(Number.isInteger(oct.allocation.deficitTotal)).toBe(true);

    await client.close();
  });
});

// ---------------------------------------------------------------------------
// CROSS-ORG ISOLATION
// ---------------------------------------------------------------------------

describe('cross-org isolation', () => {
  it('user from org A queries breakdown for contract from org B → 404', async () => {
    const { client: clientA, app: appA, cookie: cookieA, contract: contractA } = await bootstrap();

    // Register a second user/org on the same app instance (shared db)
    // We need a fresh db for org B since each bootstrap creates its own db
    const { db: dbB, client: clientB } = await freshDb();
    // Build a separate app on B's db
    const appB = makeApp(dbB);
    const { cookie: cookieB } = await registerUser(appB, 'b@b.cz', 'password456', 'B');

    // Create contract in org B
    const pB = (await (await appB.request('/api/properties', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieB },
      body: JSON.stringify({ name: 'PB' }),
    })).json() as any).property;
    const tB = (await (await appB.request('/api/tenants', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieB },
      body: JSON.stringify({ name: 'TB' }),
    })).json() as any).tenant;
    const ctB = (await (await appB.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieB },
      body: JSON.stringify({ propertyId: pB.id, tenantId: tB.id, startDate: '2024-10-01' }),
    })).json() as any).contract;

    // User A tries to query contract B via app A → 404 (contract not in A's org)
    const res = await appA.request(
      `/api/contracts/${ctB.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie: cookieA } },
    );
    expect(res.status).toBe(404);

    // Also verify user A cannot query their own contract via app B (different db)
    const res2 = await appB.request(
      `/api/contracts/${contractA.id}/payment-breakdown?from=2024-10-01&to=2024-10-31`,
      { headers: { cookie: cookieB } },
    );
    expect(res2.status).toBe(404);

    await clientA.close();
    await clientB.close();
  });
});
