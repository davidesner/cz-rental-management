import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

describe('property tariffs (SCD2)', () => {
  it('temporal tariff sequence', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    await app.request('/api/organizations', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'O' }) });
    const p = (await (await app.request('/api/properties', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'KP' }) })).json() as any).property;

    await app.request(`/api/properties/${p.id}/tariffs`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2023-11-01',
        totalSvjAdvance: 888400, deductibleAmount: 187800,
        deductibleNote: 'Fond oprav 1424 + Odměny výbor 110 + Pojištění 85 + Správa 213 + Ostatní režie 46',
      }),
    });
    await app.request(`/api/properties/${p.id}/tariffs`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2026-11-01',
        totalSvjAdvance: 920000, deductibleAmount: 195000,
      }),
    });
    const list = await app.request(`/api/properties/${p.id}/tariffs`, { headers: { cookie } });
    const rows = (await list.json() as any).tariffs;
    expect(rows).toHaveLength(2);
    expect(rows[0].validTo).toBe('2026-11-01');
    expect(rows[0].deductibleAmount).toBe(187800);
    expect(rows[1].validTo).toBeNull();
    await client.close();
  });
});
