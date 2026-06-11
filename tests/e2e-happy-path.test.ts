import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

describe('end-to-end: register → org → token → property → access', () => {
  it('exercises the whole Plan 1 surface', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);

    const { cookie } = await registerUser(app, 'esnerda@gmail.com', 'password123', 'David');

    const orgRes = await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'David rentals' }),
    });
    expect(orgRes.status).toBe(201);
    const org = (await orgRes.json() as any).organization;

    // x-org-id ties the token to "David rentals" org (default would be auto-org from better-auth hook)
    const tokRes = await app.request('/api/api-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-org-id': org.id },
      body: JSON.stringify({ name: 'mcp-laptop' }),
    });
    expect(tokRes.status).toBe(201);
    const { token } = await tokRes.json() as { token: string };

    const me = await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    const meBody = await me.json() as any;
    // Find the "David rentals" membership specifically (auto-org membership also present)
    const davidMembership = meBody.memberships.find((m: any) => m.orgId === org.id);
    expect(davidMembership).toBeDefined();
    expect(davidMembership.role).toBe('owner');

    const propRes = await app.request('/api/properties', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: '<property-name>' }),
    });
    expect(propRes.status).toBe(201);
    const prop = (await propRes.json() as any).property;

    const grant = await app.request('/api/property-access', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, 'x-org-id': org.id },
      body: JSON.stringify({ membershipId: org.membershipId, propertyId: prop.id }),
    });
    expect(grant.status).toBe(201);

    const list = await app.request(`/api/property-access?membershipId=${org.membershipId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.status).toBe(200);
    expect((await list.json() as any).propertyIds).toEqual([prop.id]);

    await client.close();
  });
});
