import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

describe('GET /api/me', () => {
  it('returns user and all memberships', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'Alice');
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
    const res = await app.request('/api/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      user: { email: string };
      memberships: unknown[];
      activeOrgId: string | null;
    };
    expect(body.user.email).toBe('a@b.cz');
    // 3 memberships: auto-org (created by better-auth user.create.after hook) + A + B
    expect(body.memberships).toHaveLength(3);
    expect(body.activeOrgId).toBeTruthy();
    await client.close();
  });
});
