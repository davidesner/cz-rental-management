import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { createOrganization, listOrganizationsForUser } from '../core/services/organization.js';
import { user } from '../core/db/schema.js';

async function makeUser(db: any, id = 'u_1') {
  await db.insert(user).values({ id, name: 'A', email: `${id}@x.cz`, emailVerified: false });
  return id;
}

describe('organization service', () => {
  it('creates an org and an owner membership', async () => {
    const { db, client } = await freshDb();
    const uid = await makeUser(db);
    const org = await createOrganization(db, { userId: uid, name: 'Acme' });
    expect(org.id).toBeTruthy();
    expect(org.role).toBe('owner');
    const list = await listOrganizationsForUser(db, uid);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Acme');
    client.close();
  });

  it('lists multiple orgs for same user', async () => {
    const { db, client } = await freshDb();
    const uid = await makeUser(db);
    await createOrganization(db, { userId: uid, name: 'A' });
    await createOrganization(db, { userId: uid, name: 'B' });
    const list = await listOrganizationsForUser(db, uid);
    expect(list.map((o) => o.name).sort()).toEqual(['A', 'B']);
    client.close();
  });
});
