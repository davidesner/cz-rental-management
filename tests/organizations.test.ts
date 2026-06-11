import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

describe('POST /api/organizations', () => {
  it('creates an org and returns owner membership', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    const res = await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Acme' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { organization: { name: string; role: string } };
    expect(body.organization.name).toBe('Acme');
    expect(body.organization.role).toBe('owner');
    await client.close();
  });
});

describe('GET /api/organizations', () => {
  it('lists user organizations', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'A' }),
    });
    await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'B' }),
    });
    const res = await app.request('/api/organizations', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { organizations: unknown[] };
    // 3 orgs: auto-org (created by better-auth user.create.after hook) + A + B
    expect(body.organizations).toHaveLength(3);
    await client.close();
  });
});
