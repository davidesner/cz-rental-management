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
  return { client, app, cookie, property: p };
}

describe('cost statements REST', () => {
  it('create + list filter + update + delete', async () => {
    const { client, app, cookie, property } = await bootstrap();
    const a = await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'services',
        periodFrom: '2024-09-20', periodTo: '2024-12-31',
        totalAmount: 2999949, adjustmentAmount: -625374,
        adjustmentNote: 'FO portion (1424+110+85+213+46 = 1878 Kč/měs × 3.43 months ~= 6253)',
      }),
    });
    expect(a.status).toBe(201);
    const sA = (await a.json() as any).statement;
    expect(sA.adjustmentAmount).toBe(-625374);

    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2024-09-20', periodTo: '2024-12-31',
        totalAmount: 316867, adjustmentAmount: 0,
      }),
    });

    const elList = await app.request(`/api/cost-statements?propertyId=${property.id}&kind=electricity`, { headers: { cookie } });
    expect((await elList.json() as any).statements).toHaveLength(1);

    const patch = await app.request(`/api/cost-statements/${sA.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ note: 'verified against SVJ document' }),
    });
    expect((await patch.json() as any).statement.note).toBe('verified against SVJ document');

    const del = await app.request(`/api/cost-statements/${sA.id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(204);
    await client.close();
  });
});
