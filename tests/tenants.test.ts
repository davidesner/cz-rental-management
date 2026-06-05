import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

async function setup() {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
  await app.request('/api/organizations', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'O' }),
  });
  return { db, client, app, cookie };
}

describe('tenants REST', () => {
  it('create + list + get + update', async () => {
    const { client, app, cookie } = await setup();
    const c1 = await app.request('/api/tenants', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: '<tenant-name>', accountNumber: '294153028/0300' }),
    });
    expect(c1.status).toBe(201);
    const t = (await c1.json() as any).tenant;
    expect(t.name).toBe('<tenant-name>');

    const list = await app.request('/api/tenants', { headers: { cookie } });
    expect((await list.json() as any).tenants).toHaveLength(1);

    const get = await app.request(`/api/tenants/${t.id}`, { headers: { cookie } });
    expect((await get.json() as any).tenant.accountNumber).toBe('294153028/0300');

    const patch = await app.request(`/api/tenants/${t.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ email: 'stefan@example.com' }),
    });
    expect((await patch.json() as any).tenant.email).toBe('stefan@example.com');
    await client.close();
  });
});
