import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

async function createOrgViaApi(app: any, cookie: string, name: string) {
  const res = await app.request('/api/organizations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name }),
  });
  return (await res.json()).organization;
}
async function createPropertyViaApi(app: any, cookie: string, name: string) {
  const res = await app.request('/api/properties', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name }),
  });
  return (await res.json()).property;
}

describe('property access', () => {
  it('grant + list + revoke', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    const org = await createOrgViaApi(app, cookie, 'O');
    const prop = await createPropertyViaApi(app, cookie, 'Byt 1');

    const grant = await app.request('/api/property-access', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ membershipId: org.membershipId, propertyId: prop.id }),
    });
    expect(grant.status).toBe(201);

    const list = await app.request(`/api/property-access?membershipId=${org.membershipId}`, { headers: { cookie } });
    const body = await list.json() as { propertyIds: string[] };
    expect(body.propertyIds).toEqual([prop.id]);

    const rev = await app.request(`/api/property-access?membershipId=${org.membershipId}&propertyId=${prop.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(rev.status).toBe(204);
    client.close();
  });
});
