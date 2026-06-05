import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';
import { createOrganization } from '../core/services/organization.js';
import { generateToken, hashToken } from '../core/auth/token.js';
import { apiToken } from '../core/db/schema.js';

describe('auth middleware', () => {
  it('rejects unauthenticated request', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const res = await app.request('/api/me');
    expect(res.status).toBe(401);
    client.close();
  });

  it('accepts session cookie', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { userId, cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    await createOrganization(db, { userId, name: 'O' });
    const res = await app.request('/api/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    client.close();
  });

  it('accepts bearer token', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { userId } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    const org = await createOrganization(db, { userId, name: 'O' });
    const t = generateToken();
    await db.insert(apiToken).values({
      id: 'at1', membershipId: org.membershipId, name: 't', tokenHash: hashToken(t),
    });
    const res = await app.request('/api/me', { headers: { authorization: `Bearer ${t}` } });
    expect(res.status).toBe(200);
    client.close();
  });
});
