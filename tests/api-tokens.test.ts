import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

describe('api tokens', () => {
  it('issues, lists (hash-suppressed), and revokes a token; created token authenticates /api/me', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'O' }),
    });

    const create = await app.request('/api/api-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'mcp-laptop' }),
    });
    expect(create.status).toBe(201);
    const body = await create.json() as { token: string; id: string };
    expect(body.token).toMatch(/^rmt_[a-f0-9]{64}$/);
    expect(body.id).toBeTruthy();

    const me = await app.request('/api/me', { headers: { authorization: `Bearer ${body.token}` } });
    expect(me.status).toBe(200);

    const list = await app.request('/api/api-tokens', { headers: { cookie } });
    const listBody = await list.json() as { tokens: Array<Record<string, unknown>> };
    expect(listBody.tokens).toHaveLength(1);
    expect(listBody.tokens[0]!.token).toBeUndefined();
    expect(listBody.tokens[0]!.tokenHash).toBeUndefined();

    const del = await app.request(`/api/api-tokens/${body.id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(204);

    const meAfter = await app.request('/api/me', { headers: { authorization: `Bearer ${body.token}` } });
    expect(meAfter.status).toBe(401);
    await client.close();
  });
});
