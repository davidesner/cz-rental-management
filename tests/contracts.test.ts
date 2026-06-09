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
  const pRes = await app.request('/api/properties', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: '<property-name-a>' }),
  });
  const tRes = await app.request('/api/tenants', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: '<tenant-name>' }),
  });
  return { db, client, app, cookie,
    property: (await pRes.json() as any).property,
    tenant: (await tRes.json() as any).tenant };
}

describe('contracts REST', () => {
  it('create + get + list + update', async () => {
    const { client, app, cookie, property, tenant } = await setup();
    const create = await app.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, tenantId: tenant.id,
        startDate: '2024-09-20', securityDeposit: 6600000,
      }),
    });
    expect(create.status).toBe(201);
    const ctr = (await create.json() as any).contract;
    expect(ctr.startDate).toBe('2024-09-20');

    const list = await app.request('/api/contracts', { headers: { cookie } });
    expect((await list.json() as any).contracts).toHaveLength(1);

    const patch = await app.request(`/api/contracts/${ctr.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ note: 'extended via dodatek 1' }),
    });
    expect((await patch.json() as any).contract.note).toBe('extended via dodatek 1');

    // Payment timing now lives on contractTerms (temporal); set via /terms POST
    const termsRes = await app.request(`/api/contracts/${ctr.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2024-09-20', baseRent: 3000000, serviceAdvance: 500000,
        paymentDueDay: 5, paymentAppliesTo: 'next', source: 'initial',
      }),
    });
    const created = (await termsRes.json() as any).terms;
    expect(created.paymentDueDay).toBe(5);
    expect(created.paymentAppliesTo).toBe('next');

    await client.close();
  });

  it('contract_terms_add: explicit paymentDueDay + paymentAppliesTo', async () => {
    const { client, app, cookie, property, tenant } = await setup();
    const res = await app.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, tenantId: tenant.id, startDate: '2024-01-01',
      }),
    });
    expect(res.status).toBe(201);
    const ctr = (await res.json() as any).contract;
    const termsRes = await app.request(`/api/contracts/${ctr.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2024-01-01', baseRent: 3000000, serviceAdvance: 500000,
        paymentDueDay: 15, paymentAppliesTo: 'next', source: 'initial',
      }),
    });
    const terms = (await termsRes.json() as any).terms;
    expect(terms.paymentDueDay).toBe(15);
    expect(terms.paymentAppliesTo).toBe('next');
    await client.close();
  });

  it('contract_terms_add: payment* inherits from prior open terms when omitted', async () => {
    const { client, app, cookie, property, tenant } = await setup();
    const res = await app.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ propertyId: property.id, tenantId: tenant.id, startDate: '2024-01-01' }),
    });
    const ctr = (await res.json() as any).contract;
    // First terms: set payment timing
    await app.request(`/api/contracts/${ctr.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2024-01-01', baseRent: 3000000, serviceAdvance: 500000,
        paymentDueDay: 25, paymentAppliesTo: 'next', source: 'initial',
      }),
    });
    // Second terms: omit payment*, expect inheritance from prior
    const t2Res = await app.request(`/api/contracts/${ctr.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2024-07-01', baseRent: 3200000, serviceAdvance: 500000,
        source: 'addendum',
      }),
    });
    const t2 = (await t2Res.json() as any).terms;
    expect(t2.paymentDueDay).toBe(25);
    expect(t2.paymentAppliesTo).toBe('next');
    await client.close();
  });

  it('rejects contract with property/tenant from another org', async () => {
    const { client, app, property } = await setup();
    const { cookie: cookie2 } = await registerUser(app, 'b@b.cz', 'password123', 'B');
    await app.request('/api/organizations', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie2 },
      body: JSON.stringify({ name: 'O2' }),
    });
    const tRes = await app.request('/api/tenants', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie2 },
      body: JSON.stringify({ name: 'X' }),
    });
    const t2 = (await tRes.json() as any).tenant;
    // Trying to use org1's property with org2's tenant must fail
    const bad = await app.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie2 },
      body: JSON.stringify({ propertyId: property.id, tenantId: t2.id, startDate: '2024-01-01' }),
    });
    expect(bad.status).toBe(404);
    await client.close();
  });
});
