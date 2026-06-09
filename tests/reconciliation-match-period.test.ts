import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

async function bootstrap(email = 'a@b.cz', contractStart = '2024-01-01') {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, email, 'password123', 'A');
  const p = (await (await app.request('/api/properties', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'KP' }),
  })).json() as any).property;
  const t = (await (await app.request('/api/tenants', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'SB' }),
  })).json() as any).tenant;
  const ct = (await (await app.request('/api/contracts', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: contractStart }),
  })).json() as any).contract;
  await app.request(`/api/contracts/${ct.id}/terms`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ validFrom: contractStart, baseRent: 3300000, serviceAdvance: 700000, source: 'initial' }),
  });
  await app.request(`/api/contracts/${ct.id}/utilities`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ kind: 'electricity', validFrom: contractStart, monthlyAdvance: 120000 }),
  });
  return { client, app, cookie, property: p, contract: ct };
}

describe('per-kind matchPeriod derivation', () => {
  it('matchPeriod for rent = default (no cost statement for rent kind)', async () => {
    const { client, app, cookie, contract } = await bootstrap('mp-rent@b.cz', '2024-01-01');

    const res = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-01-01', periodTo: '2024-12-31' }),
    });
    expect(res.status).toBe(201);
    const rec = (await res.json() as any).reconciliation;
    const rentItem = rec.items.find((i: any) => i.kind === 'rent');
    expect(rentItem).toBeDefined();
    expect(rentItem.breakdown.matchPeriod).toEqual({ from: '2024-01-01', to: '2024-12-31' });
    expect(rentItem.breakdown.matchPeriodSource).toBe('default');
    expect(rentItem.breakdown.matchPeriodIsDifferentFromDefault).toBe(false);

    await client.close();
  }, 30_000);

  it('electricity statement with Feb-Feb period in Jan-Dec recon → matchPeriod = Feb-Feb, payments matched Feb-Feb', async () => {
    // Contract Jan 2024; electricity utility 120 Kč/month.
    // Electricity cost statement period: 2024-02-15 to 2025-02-14 (billing cycle).
    // Payments: one in Feb 2024 for full month. Recon: 2024-01-01 to 2024-12-31.
    //
    // Expected: matchPeriod for electricity = 2024-02-15 to 2025-02-14 (from statement).
    // Paid for electricity = sum of paidThisKind for months 2024-02 to 2024-12 only.
    const { client, app, cookie, property, contract } = await bootstrap('mp-feb@b.cz', '2024-01-01');

    // Add electricity cost statement with Feb-Feb period
    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2024-02-15', periodTo: '2025-02-14',
        totalAmount: 1500000, adjustmentAmount: 0,
      }),
    });

    // Add 12 monthly payments (full months, Jan-Dec 2024)
    for (let m = 1; m <= 12; m++) {
      const month = String(m).padStart(2, '0');
      await app.request('/api/payments/batch', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify([{
          amount: 4120000, paidAt: `2024-${month}-10`, source: 'bank',
          externalId: `mp-feb-${month}`, contractId: contract.id, counterparty: 'TENANT',
        }]),
      });
    }

    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-01-01', periodTo: '2024-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;

    const elecItem = rec.items.find((i: any) => i.kind === 'electricity');
    expect(elecItem).toBeDefined();
    // matchPeriod derived from statement
    expect(elecItem.breakdown.matchPeriod).toEqual({ from: '2024-02-15', to: '2025-02-14' });
    expect(elecItem.breakdown.matchPeriodSource).toBe('from-cost-statements');
    expect(elecItem.breakdown.matchPeriodIsDifferentFromDefault).toBe(true);

    // breakdown.months obsahuje JEN měsíce v matchPeriod (Feb 2024 - Feb 2025)
    // Jan 2024 NEMÁ být v breakdown.months — je mimo matchPeriod
    const janMonth = elecItem.breakdown.months.find((m: any) => m.month === '2024-01');
    expect(janMonth).toBeUndefined();
    // První měsíc v breakdown musí být 2024-02 (start matchPeriod)
    const firstMonth = elecItem.breakdown.months[0];
    expect(firstMonth.month).toBe('2024-02');
    // Poslední měsíc 2025-02 (end matchPeriod) — protože union extension přidala 2025-01 a 2025-02 slotů
    const lastMonth = elecItem.breakdown.months[elecItem.breakdown.months.length - 1];
    expect(lastMonth.month).toBe('2025-02');
    // paid = sum všech měsíců v breakdown
    const sumPaid = elecItem.breakdown.months.reduce((s: number, m: any) => s + m.paidThisKind, 0);
    expect(elecItem.paid).toBe(sumPaid);

    await client.close();
  }, 30_000);

  it('12 monthly statements (Jan-Dec) → matchPeriod = union = Jan-Dec (same as default, source=from-cost-statements)', async () => {
    // 12 monthly cost statements each starting in their respective month → all have periodFrom within recon period.
    // Union: min(Jan-01) to max(Dec-31) = 2024-01-01 to 2024-12-31.
    // matchPeriodIsDifferentFromDefault = false because union equals recon period.
    const { client, app, cookie, property, contract } = await bootstrap('mp-monthly@b.cz', '2024-01-01');

    for (let m = 1; m <= 12; m++) {
      const month = String(m).padStart(2, '0');
      const lastDay = new Date(2024, m, 0).getDate();
      await app.request('/api/cost-statements', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          propertyId: property.id, kind: 'electricity',
          periodFrom: `2024-${month}-01`, periodTo: `2024-${month}-${lastDay}`,
          totalAmount: 100000, adjustmentAmount: 0,
        }),
      });
    }

    // Add one payment to make item appear
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([{
        amount: 4120000, paidAt: '2024-06-10', source: 'bank',
        externalId: 'mp-monthly-june', contractId: contract.id, counterparty: 'TENANT',
      }]),
    });

    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-01-01', periodTo: '2024-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;

    const elecItem = rec.items.find((i: any) => i.kind === 'electricity');
    expect(elecItem).toBeDefined();
    expect(elecItem.breakdown.matchPeriod).toEqual({ from: '2024-01-01', to: '2024-12-31' });
    expect(elecItem.breakdown.matchPeriodSource).toBe('from-cost-statements');
    // Union equals the default period → isDifferentFromDefault = false
    expect(elecItem.breakdown.matchPeriodIsDifferentFromDefault).toBe(false);
    // actualCost = 12 × 100000 = 1200000
    expect(elecItem.actualCost).toBe(1200000);

    await client.close();
  }, 30_000);

  it('cost statement starting Dec 2023 (before 2024-01-01 recon) → NOT included, matchPeriod = default', async () => {
    // Statement: periodFrom 2023-12-01, periodTo 2024-01-31
    // Recon: 2024-01-01 to 2024-12-31
    // periodFrom (2023-12-01) < reconPeriodFrom (2024-01-01) → does NOT qualify as candidate
    // → matchPeriod = default, actualCost = 0
    const { client, app, cookie, property, contract } = await bootstrap('mp-crossyear@b.cz', '2024-01-01');

    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2023-12-01', periodTo: '2024-01-31',
        totalAmount: 200000, adjustmentAmount: 0,
      }),
    });

    // Add payment to trigger item appearing
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([{
        amount: 4120000, paidAt: '2024-01-10', source: 'bank',
        externalId: 'mp-cross-jan', contractId: contract.id, counterparty: 'TENANT',
      }]),
    });

    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-01-01', periodTo: '2024-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;

    const elecItem = rec.items.find((i: any) => i.kind === 'electricity');
    expect(elecItem).toBeDefined();
    // Statement's periodFrom is before reconPeriodFrom → not included
    expect(elecItem.breakdown.costStatements).toHaveLength(0);
    expect(elecItem.actualCost).toBe(0);
    // matchPeriod = default (no qualifying statements)
    expect(elecItem.breakdown.matchPeriod).toEqual({ from: '2024-01-01', to: '2024-12-31' });
    expect(elecItem.breakdown.matchPeriodSource).toBe('default');
    expect(elecItem.breakdown.matchPeriodIsDifferentFromDefault).toBe(false);

    await client.close();
  }, 30_000);
});
