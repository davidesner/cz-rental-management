import { describe, it, expect } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';
import { membership, propertyAccess, payment } from '../core/db/schema.js';

async function bootstrap() {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
  await app.request('/api/organizations', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'O' }) });
  const p = (await (await app.request('/api/properties', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'KP' }) })).json() as any).property;
  const t = (await (await app.request('/api/tenants', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'SB' }) })).json() as any).tenant;
  const ct = (await (await app.request('/api/contracts', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: '2024-09-20' }) })).json() as any).contract;
  return { db, client, app, cookie, contract: ct };
}

describe('payments REST', () => {
  it('create + list + get + assign + delete', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    const create = await app.request('/api/payments', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ amount: 4120000, paidAt: '2024-10-10', source: 'bank', externalId: 'tx-1', counterparty: 'BOHUS STEFAN' }),
    });
    expect(create.status).toBe(201);
    const p = (await create.json() as any).payment;
    expect(p.contractId).toBeNull();

    const assign = await app.request(`/api/payments/${p.id}/assign`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contractId: contract.id }),
    });
    expect((await assign.json() as any).payment.contractId).toBe(contract.id);

    const inbox = await app.request('/api/payments?unassigned=true', { headers: { cookie } });
    expect((await inbox.json() as any).payments).toHaveLength(0);

    const del = await app.request(`/api/payments/${p.id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(204);
    await client.close();
  });

  it('idempotent batch by externalId', async () => {
    const { client, app, cookie } = await bootstrap();
    const body = [
      { amount: 4120000, paidAt: '2024-10-10', source: 'bank', externalId: 'tx-A' },
      { amount: 4120000, paidAt: '2024-11-10', source: 'bank', externalId: 'tx-B' },
    ];
    const first = await app.request('/api/payments/batch', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
    const r1 = await first.json() as any;
    expect(r1.created).toHaveLength(2);
    expect(r1.existing).toHaveLength(0);
    const second = await app.request('/api/payments/batch', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
    const r2 = await second.json() as any;
    expect(r2.created).toHaveLength(0);
    expect(r2.existing).toHaveLength(2);
    const list = await app.request('/api/payments', { headers: { cookie } });
    expect((await list.json() as any).payments).toHaveLength(2);
    await client.close();
  });

  it('returns contract names, and nulls for an unassigned payment', async () => {
    const { client, app, cookie, contract: c } = await bootstrap();

    await app.request('/api/payments', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contractId: c.id, amount: 1200000, paidAt: '2024-10-01', source: 'manual' }),
    });
    await app.request('/api/payments', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contractId: null, amount: 500000, paidAt: '2024-10-02', source: 'manual' }),
    });

    const res = await app.request('/api/payments', { headers: { cookie } });
    const payments = (await res.json() as any).payments as any[];

    const assigned = payments.find(p => p.contractId === c.id);
    // bootstrap() in this file creates the property as 'KP' and the tenant as 'SB'.
    expect(assigned.propertyName).toBe('KP');
    expect(assigned.tenantName).toBe('SB');

    const unassigned = payments.find(p => p.contractId === null);
    expect(unassigned).toBeDefined();               // leftJoin must not drop it
    expect(unassigned.propertyName).toBeNull();
    expect(unassigned.tenantName).toBeNull();

    await client.close();
  });

  it('every write endpoint returns real names or null, never undefined (regression: raw .returning() rows cannot carry joined names)', async () => {
    const { client, app, cookie, contract: c } = await bootstrap();
    try {
      // POST /api/payments — created assigned to a contract
      const createAssigned = await app.request('/api/payments', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ contractId: c.id, amount: 100000, paidAt: '2024-10-01', source: 'manual' }),
      });
      const assignedPayment = (await createAssigned.json() as any).payment;
      // bootstrap() in this file creates the property as 'KP' and the tenant as 'SB'.
      expect(assignedPayment.propertyName).toBe('KP');
      expect(assignedPayment.tenantName).toBe('SB');

      // POST /api/payments — created unassigned (names must be null, not undefined)
      const createUnassigned = await app.request('/api/payments', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ contractId: null, amount: 200000, paidAt: '2024-10-02', source: 'manual' }),
      });
      const unassignedPayment = (await createUnassigned.json() as any).payment;
      expect(unassignedPayment.propertyName).toBeNull();
      expect(unassignedPayment.tenantName).toBeNull();

      // PATCH /api/payments/:id/assign
      const assignRes = await app.request(`/api/payments/${unassignedPayment.id}/assign`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ contractId: c.id }),
      });
      const assignedViaPatch = (await assignRes.json() as any).payment;
      expect(assignedViaPatch.propertyName).toBe('KP');
      expect(assignedViaPatch.tenantName).toBe('SB');

      // PATCH /api/payments/:id (non-contract field, exercises the update+refetch path)
      const updateRes = await app.request(`/api/payments/${assignedViaPatch.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ note: 'hello' }),
      });
      const updatedPayment = (await updateRes.json() as any).payment;
      expect(updatedPayment.propertyName).toBe('KP');
      expect(updatedPayment.tenantName).toBe('SB');

      // POST /api/payments/batch — one assigned, one unassigned
      const batchRes = await app.request('/api/payments/batch', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify([
          { contractId: c.id, amount: 300000, paidAt: '2024-10-03', source: 'manual' },
          { contractId: null, amount: 400000, paidAt: '2024-10-04', source: 'manual' },
        ]),
      });
      const batchBody = await batchRes.json() as any;
      const batchAssigned = batchBody.created.find((p: any) => p.contractId === c.id);
      const batchUnassigned = batchBody.created.find((p: any) => p.contractId === null);
      expect(batchAssigned.propertyName).toBe('KP');
      expect(batchAssigned.tenantName).toBe('SB');
      expect(batchUnassigned.propertyName).toBeNull();
      expect(batchUnassigned.tenantName).toBeNull();
    } finally {
      await client.close();
    }
  });

  it("member restricted to one property is denied access to another property's payment via idempotent externalId match", async () => {
    const { db, client, app, cookie: ownerCookie, contract: contractA } = await bootstrap();
    try {
      // A second property/tenant/contract in the SAME org, owned by the same owner.
      const propB = (await (await app.request('/api/properties', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ name: 'PropB' }),
      })).json() as any).property;
      const tenantB = (await (await app.request('/api/tenants', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ name: 'TenantB' }),
      })).json() as any).tenant;
      const contractB = (await (await app.request('/api/contracts', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ propertyId: propB.id, tenantId: tenantB.id, startDate: '2024-09-20' }),
      })).json() as any).contract;

      // Owner creates a payment already assigned to contractB (property B), with a known externalId.
      const seed = await app.request('/api/payments', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ contractId: contractB.id, amount: 100000, paidAt: '2024-10-01', source: 'bank', externalId: 'shared-ext' }),
      });
      expect(seed.status).toBe(201);

      // A second user, wired into the SAME org as a 'member' restricted to
      // property A ('KP') only. There is no HTTP invite endpoint in this
      // codebase — membership/propertyAccess rows are the mechanism
      // authMiddleware itself reads, so we insert them directly, same as
      // tests/auth-middleware.test.ts does for api tokens.
      const { userId: memberUserId, cookie: memberCookie } = await registerUser(app, 'member@b.cz', 'password123', 'M');
      const orgId = contractA.orgId;
      const membershipId = createId();
      await db.insert(membership).values({ id: membershipId, userId: memberUserId, orgId, role: 'member' });
      await db.insert(propertyAccess).values({ membershipId, propertyId: contractA.propertyId });

      // The member attempts the same idempotent duplicate POST (same org,
      // same externalId) that would otherwise return the existing row —
      // one actually assigned to property B, which this member cannot see.
      // x-org-id selects the membership in the owner's org (the member's own
      // auto-created org would otherwise win).
      const dup = await app.request('/api/payments', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: memberCookie, 'x-org-id': orgId },
        body: JSON.stringify({ contractId: contractA.id, amount: 100000, paidAt: '2024-10-01', source: 'bank', externalId: 'shared-ext' }),
      });

      expect(dup.status).toBe(403);
      const dupText = JSON.stringify(await dup.json());
      // The bug this guards against: the response body carrying property B's
      // (or its tenant's) name instead of a clean 403.
      expect(dupText).not.toContain('PropB');
      expect(dupText).not.toContain('TenantB');
    } finally {
      await client.close();
    }
  });

  it("member restricted to one property is denied access to another property's payment via a batch idempotent externalId match", async () => {
    // Same leak as the single-POST test above, but exercising
    // recordPaymentsBatch's existingIds branch specifically — it has
    // genuinely distinct logic (inspects contractPropertyId inline from the
    // batched inArray result rather than re-fetching through getPayment), so
    // it needs its own committed coverage rather than relying on the
    // single-POST test to stand in for it.
    const { db, client, app, cookie: ownerCookie, contract: contractA } = await bootstrap();
    try {
      // A second property/tenant/contract in the SAME org, owned by the same owner.
      const propB = (await (await app.request('/api/properties', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ name: 'PropB' }),
      })).json() as any).property;
      const tenantB = (await (await app.request('/api/tenants', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ name: 'TenantB' }),
      })).json() as any).tenant;
      const contractB = (await (await app.request('/api/contracts', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ propertyId: propB.id, tenantId: tenantB.id, startDate: '2024-09-20' }),
      })).json() as any).contract;

      // Owner seeds a payment assigned to contractB (property B) via the
      // batch endpoint, with a known externalId.
      const seed = await app.request('/api/payments/batch', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify([{ contractId: contractB.id, amount: 100000, paidAt: '2024-10-01', source: 'bank', externalId: 'batch-shared-ext' }]),
      });
      expect(seed.status).toBe(201);

      // Same restricted-member setup as the single-POST test: direct
      // membership/propertyAccess rows, no HTTP invite endpoint exists.
      const { userId: memberUserId, cookie: memberCookie } = await registerUser(app, 'member2@b.cz', 'password123', 'M2');
      const orgId = contractA.orgId;
      const membershipId = createId();
      await db.insert(membership).values({ id: membershipId, userId: memberUserId, orgId, role: 'member' });
      await db.insert(propertyAccess).values({ membershipId, propertyId: contractA.propertyId });

      // The member submits a batch containing the same externalId,
      // referencing contractA (which the member *can* access) — the row the
      // endpoint actually resolves is the one seeded above, on property B.
      const dup = await app.request('/api/payments/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: memberCookie, 'x-org-id': orgId },
        body: JSON.stringify([{ contractId: contractA.id, amount: 100000, paidAt: '2024-10-01', source: 'bank', externalId: 'batch-shared-ext' }]),
      });

      expect(dup.status).toBe(403);
      const dupText = JSON.stringify(await dup.json());
      expect(dupText).not.toContain('PropB');
      expect(dupText).not.toContain('TenantB');
    } finally {
      await client.close();
    }
  });

  it('listPayments and getPayment agree about a payment whose contract does not resolve', async () => {
    const { db, client, app, cookie: ownerCookie, contract: contractA } = await bootstrap();
    try {
      const orgId = contractA.orgId;

      // Build a contract that belongs to a DIFFERENT org. payment.contractId is
      // a bare FK to contract.id with no org predicate, while the name joins are
      // org-scoped — so a payment in org A pointing at org B's contract joins to
      // nothing and yields contractPropertyId === null with contractId !== null.
      // That is the one state where list and get could apply different rules.
      const { cookie: otherCookie } = await registerUser(app, 'other-org@b.cz', 'password123', 'O');
      const otherProp = (await (await app.request('/api/properties', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: otherCookie },
        body: JSON.stringify({ name: 'ForeignProp' }),
      })).json() as any).property;
      const otherTenant = (await (await app.request('/api/tenants', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: otherCookie },
        body: JSON.stringify({ name: 'ForeignTenant' }),
      })).json() as any).tenant;
      const foreignContract = (await (await app.request('/api/contracts', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: otherCookie },
        body: JSON.stringify({ propertyId: otherProp.id, tenantId: otherTenant.id, startDate: '2024-01-01' }),
      })).json() as any).contract;
      expect(foreignContract.orgId).not.toBe(orgId);

      await db.insert(payment).values({
        id: 'p-dangling', orgId, contractId: foreignContract.id,
        amount: 50000, paidAt: '2024-10-05', source: 'manual',
      });

      // A member of org A restricted to a property that is not contractA's.
      const propB = (await (await app.request('/api/properties', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ name: 'PropB' }),
      })).json() as any).property;
      const { userId: memberUserId, cookie: memberCookie } = await registerUser(app, 'member2@b.cz', 'password123', 'M2');
      const membershipId = 'm-list-get-agree';
      await db.insert(membership).values({ id: membershipId, userId: memberUserId, orgId, role: 'member' });
      await db.insert(propertyAccess).values({ membershipId, propertyId: propB.id });

      const listRes = await app.request('/api/payments', {
        headers: { cookie: memberCookie, 'x-org-id': orgId },
      });
      const listed = (await listRes.json() as any).payments as any[];
      const inList = listed.some(p => p.id === 'p-dangling');

      const getRes = await app.request('/api/payments/p-dangling', {
        headers: { cookie: memberCookie, 'x-org-id': orgId },
      });
      const readable = getRes.status === 200;

      // Whatever the rule is, list and get must apply the SAME one.
      expect(inList).toBe(readable);
      // And the safe rule is: not visible. It is an assigned payment whose
      // contract the member demonstrably cannot reach.
      expect(inList).toBe(false);
    } finally {
      await client.close();
    }
  });
});
