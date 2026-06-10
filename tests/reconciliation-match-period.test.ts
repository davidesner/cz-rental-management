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

  it('auto-shift: subsequent cross-year statement shifts matchPeriod past boundary month (no double-count)', async () => {
    // Scenario: <property-name-b> electricity has annual PRE cycle Feb 15 → Feb 14.
    //   Statement A: 2024-02-15 → 2025-02-14 (covers 2024 recon, 13 months Feb 2024 - Feb 2025)
    //   Statement B: 2025-02-15 → 2026-02-14 (would normally cover Feb 2025 - Feb 2026, 13 months)
    // With auto-shift: B's matchPeriod start gets shifted to Mar 2025 because A ends in Feb 2025.
    // Net result: Feb 2025 belongs ONLY to A's matchPeriod (in 2024 recon), and B covers
    // 12 months Mar 2025 - Feb 2026 in 2025 recon. No double-count.
    const { client, app, cookie, property, contract } = await bootstrap('mp-shift@b.cz', '2024-01-01');

    // Statement A (for 2024 recon)
    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2024-02-15', periodTo: '2025-02-14',
        totalAmount: 1500000, adjustmentAmount: 0,
      }),
    });
    // Statement B (for 2025 recon)
    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2025-02-15', periodTo: '2026-02-14',
        totalAmount: 1500000, adjustmentAmount: 0,
      }),
    });

    // Run 2024 recon — Statement A is candidate. No prior → no shift.
    const comp2024 = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-01-01', periodTo: '2024-12-31' }),
    });
    expect(comp2024.status).toBe(201);
    const rec2024 = (await comp2024.json() as any).reconciliation;
    const elec2024 = rec2024.items.find((i: any) => i.kind === 'electricity');
    expect(elec2024.breakdown.matchPeriod).toEqual({ from: '2024-02-15', to: '2025-02-14' });
    expect(elec2024.breakdown.matchPeriodNaturalFrom).toBeUndefined(); // no shift
    // breakdown.months for elec: Feb 2024 through Feb 2025 (13 months)
    expect(elec2024.breakdown.months[0].month).toBe('2024-02');
    expect(elec2024.breakdown.months[elec2024.breakdown.months.length - 1].month).toBe('2025-02');
    expect(elec2024.breakdown.months).toHaveLength(13);

    // Run 2025 recon — Statement B is candidate. Statement A ends in 2025-02 → shift B's start to Mar 2025.
    const comp2025 = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2025-01-01', periodTo: '2025-12-31' }),
    });
    expect(comp2025.status).toBe(201);
    const rec2025 = (await comp2025.json() as any).reconciliation;
    const elec2025 = rec2025.items.find((i: any) => i.kind === 'electricity');
    // matchPeriod start shifted from 2025-02-15 to 2025-03-01
    expect(elec2025.breakdown.matchPeriod).toEqual({ from: '2025-03-01', to: '2026-02-14' });
    expect(elec2025.breakdown.matchPeriodNaturalFrom).toBe('2025-02-15');
    // breakdown.months for elec: Mar 2025 through Feb 2026 (12 months, NO Feb 2025)
    expect(elec2025.breakdown.months[0].month).toBe('2025-03');
    expect(elec2025.breakdown.months[elec2025.breakdown.months.length - 1].month).toBe('2026-02');
    expect(elec2025.breakdown.months).toHaveLength(12);
    // Feb 2025 NOT in 2025 elec breakdown (claimed by 2024 recon's Statement A)
    expect(elec2025.breakdown.months.find((m: any) => m.month === '2025-02')).toBeUndefined();

    await client.close();
  }, 30_000);

  it('gap detection: warning when statements have a gap intersecting recon period', async () => {
    // Statement A: 2024-01-01 → 2024-12-31 (full year)
    // Statement B: 2025-04-01 → 2025-12-31 (skip Jan-Mar 2025!)
    // For 2025 recon: B is candidate. Gap = 2025-01-01 → 2025-03-31 (3 months).
    // Gap intersects recon period (Jan-Dec 2025) → surfaced as warning in breakdown.gaps.
    const { client, app, cookie, property, contract } = await bootstrap('mp-gapwarn@b.cz', '2024-01-01');

    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2024-01-01', periodTo: '2024-12-31',
        totalAmount: 1000000, adjustmentAmount: 0,
      }),
    });
    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2025-04-01', periodTo: '2025-12-31',
        totalAmount: 800000, adjustmentAmount: 0,
      }),
    });
    // Add a payment so electricity item appears (otherwise actual=0 && paid=0 → skipped)
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([{
        amount: 4120000, paidAt: '2025-06-10', source: 'bank',
        externalId: 'mp-gap-jun', contractId: contract.id, counterparty: 'TENANT',
      }]),
    });

    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2025-01-01', periodTo: '2025-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;
    const elec = rec.items.find((i: any) => i.kind === 'electricity');
    expect(elec).toBeDefined();
    expect(elec.breakdown.gaps).toBeDefined();
    expect(elec.breakdown.gaps).toHaveLength(1);
    expect(elec.breakdown.gaps[0]).toEqual({ from: '2025-01-01', to: '2025-03-31' });

    await client.close();
  }, 30_000);

  it('no gap warning: consecutive statements touch exactly (A end + 1 day = B start)', async () => {
    // Statement A: 2024-02-15 → 2025-02-14
    // Statement B: 2025-02-15 → 2026-02-14 (B.periodFrom = A.periodTo + 1 day)
    // No gap.
    const { client, app, cookie, property, contract } = await bootstrap('mp-touching@b.cz', '2024-01-01');

    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2024-02-15', periodTo: '2025-02-14',
        totalAmount: 1500000, adjustmentAmount: 0,
      }),
    });
    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2025-02-15', periodTo: '2026-02-14',
        totalAmount: 1500000, adjustmentAmount: 0,
      }),
    });

    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2025-01-01', periodTo: '2025-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;
    const elec = rec.items.find((i: any) => i.kind === 'electricity');
    expect(elec.breakdown.gaps).toBeUndefined();

    await client.close();
  }, 30_000);

  it('no shift: gap between statements (prior ends earlier, no boundary touch)', async () => {
    // Statement A: 2024-01-01 → 2024-12-31 (calendar year)
    // Statement B: 2026-02-15 → 2027-02-14 (skip 2025, no overlap)
    // For 2026 recon: B is candidate. Prior A ends in 2024-12, B starts in 2026-02 → no boundary match → no shift.
    const { client, app, cookie, property, contract } = await bootstrap('mp-gap@b.cz', '2024-01-01');

    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2024-01-01', periodTo: '2024-12-31',
        totalAmount: 1000000, adjustmentAmount: 0,
      }),
    });
    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2026-02-15', periodTo: '2027-02-14',
        totalAmount: 1500000, adjustmentAmount: 0,
      }),
    });

    // Run 2026 recon — B is candidate. A is NOT a touching prior (ends Dec 2024, not Feb 2026).
    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2026-01-01', periodTo: '2026-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;
    const elec = rec.items.find((i: any) => i.kind === 'electricity');
    // No shift — matchPeriod = natural B
    expect(elec.breakdown.matchPeriod).toEqual({ from: '2026-02-15', to: '2027-02-14' });
    expect(elec.breakdown.matchPeriodNaturalFrom).toBeUndefined();
    expect(elec.breakdown.months[0].month).toBe('2026-02');
    expect(elec.breakdown.months).toHaveLength(13);

    await client.close();
  }, 30_000);
});
