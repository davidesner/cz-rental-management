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

  it('contract_terms PATCH: in-place update existing row (baseRent + payment timing + note)', async () => {
    const { client, app, cookie, property, tenant } = await setup();
    const ctr = (await (await app.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ propertyId: property.id, tenantId: tenant.id, startDate: '2024-01-01' }),
    })).json() as any).contract;
    const created = (await (await app.request(`/api/contracts/${ctr.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2024-01-01', baseRent: 3000000, serviceAdvance: 500000,
        paymentDueDay: 25, paymentAppliesTo: 'next', source: 'initial', note: 'typo',
      }),
    })).json() as any).terms;

    // PATCH baseRent + paymentDueDay + note
    const patchRes = await app.request(`/api/contracts/${ctr.id}/terms/${created.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ baseRent: 3200000, paymentDueDay: 28, note: 'opraveno' }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json() as any).terms;
    expect(patched.id).toBe(created.id);
    expect(patched.baseRent).toBe(3200000);
    expect(patched.paymentDueDay).toBe(28);
    expect(patched.paymentAppliesTo).toBe('next'); // unchanged
    expect(patched.serviceAdvance).toBe(500000);    // unchanged
    expect(patched.validFrom).toBe('2024-01-01');   // immutable
    expect(patched.note).toBe('opraveno');

    // List confirms persisted change (same id, same validFrom — in-place update, NOT new row)
    const listed = (await (await app.request(`/api/contracts/${ctr.id}/terms`, { headers: { cookie } })).json() as any).terms;
    expect(listed).toHaveLength(1);
    expect(listed[0].baseRent).toBe(3200000);

    await client.close();
  });

  it('contract_terms: documentRef nastavitelný v POST a PATCH', async () => {
    const { client, app, cookie, property, tenant } = await setup();
    const ctr = (await (await app.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ propertyId: property.id, tenantId: tenant.id, startDate: '2024-01-01' }),
    })).json() as any).contract;

    // POST initial s documentRef
    const initialRes = await app.request(`/api/contracts/${ctr.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2024-01-01', baseRent: 3000000, serviceAdvance: 500000,
        source: 'initial', documentRef: 'https://drive.google.com/file/d/abc123',
      }),
    });
    const initial = (await initialRes.json() as any).terms;
    expect(initial.documentRef).toBe('https://drive.google.com/file/d/abc123');

    // POST addendum bez documentRef → null
    const addendumRes = await app.request(`/api/contracts/${ctr.id}/terms`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        validFrom: '2025-01-01', baseRent: 3200000, serviceAdvance: 500000,
        source: 'addendum',
      }),
    });
    const addendum = (await addendumRes.json() as any).terms;
    expect(addendum.documentRef).toBeNull();

    // PATCH addendum doplnit documentRef
    const patchRes = await app.request(`/api/contracts/${ctr.id}/terms/${addendum.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ documentRef: '/Users/esner/Documents/dodatek-1.pdf' }),
    });
    const patched = (await patchRes.json() as any).terms;
    expect(patched.documentRef).toBe('/Users/esner/Documents/dodatek-1.pdf');

    // PATCH null → vymaže
    const clearRes = await app.request(`/api/contracts/${ctr.id}/terms/${addendum.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ documentRef: null }),
    });
    expect((await clearRes.json() as any).terms.documentRef).toBeNull();

    await client.close();
  });

  it('contract_terms PATCH: rejects unknown termsId', async () => {
    const { client, app, cookie, property, tenant } = await setup();
    const ctr = (await (await app.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ propertyId: property.id, tenantId: tenant.id, startDate: '2024-01-01' }),
    })).json() as any).contract;
    const res = await app.request(`/api/contracts/${ctr.id}/terms/bogus`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ baseRent: 1 }),
    });
    expect(res.status).toBe(404);
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
