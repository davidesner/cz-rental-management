import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

async function setup() {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
  const orgRes = await app.request('/api/organizations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'O' }),
  });
  return { db, client, app, cookie, org: (await orgRes.json() as any).organization };
}

describe('properties REST', () => {
  it('create + get + list + update', async () => {
    const { client, app, cookie } = await setup();
    const create = await app.request('/api/properties', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: '<property-name-a>', address: '<city>', reconciliationSkill: 'reference-reconciliation' }),
    });
    expect(create.status).toBe(201);
    const p = (await create.json() as any).property;
    expect(p.name).toBe('<property-name-a>');
    expect(p.reconciliationSkill).toBe('reference-reconciliation');

    const get = await app.request(`/api/properties/${p.id}`, { headers: { cookie } });
    expect(get.status).toBe(200);
    expect((await get.json() as any).property.address).toBe('<city>');

    const list = await app.request('/api/properties', { headers: { cookie } });
    expect((await list.json() as any).properties).toHaveLength(1);

    const patch = await app.request(`/api/properties/${p.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ note: 'updated' }),
    });
    expect(patch.status).toBe(200);
    expect((await patch.json() as any).property.note).toBe('updated');
    await client.close();
  });

  it('cross-org isolation', async () => {
    const { db, client, app, cookie } = await setup();
    const create = await app.request('/api/properties', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'A1' }),
    });
    const p = (await create.json() as any).property;

    // Second user with their own org
    const { cookie: cookie2 } = await registerUser(app, 'b@b.cz', 'password123', 'B');
    await app.request('/api/organizations', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie2 },
      body: JSON.stringify({ name: 'O2' }),
    });

    const sees = await app.request('/api/properties', { headers: { cookie: cookie2 } });
    expect((await sees.json() as any).properties).toHaveLength(0);

    const tries = await app.request(`/api/properties/${p.id}`, { headers: { cookie: cookie2 } });
    expect(tries.status).toBe(404);
    await client.close();
  });
});
