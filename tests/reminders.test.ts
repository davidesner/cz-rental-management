import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

async function bootstrap() {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
  await app.request('/api/organizations', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ name: 'O' }) });
  const h = { 'content-type': 'application/json', cookie };
  const p = (await (await app.request('/api/properties', { method: 'POST', headers: h, body: JSON.stringify({ name: '<property>' }) })).json() as any).property;
  const t = (await (await app.request('/api/tenants', { method: 'POST', headers: h, body: JSON.stringify({ name: '<tenant>' }) })).json() as any).tenant;
  const ct = (await (await app.request('/api/contracts', { method: 'POST', headers: h, body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: '2024-09-01' }) })).json() as any).contract;
  return { client, app, h, property: p, contract: ct };
}

describe('reminders REST', () => {
  it('creates, lists open first, marks done and deletes', async () => {
    const { client, app, h, contract } = await bootstrap();

    const created = await app.request('/api/reminders', { method: 'POST', headers: h, body: JSON.stringify({ title: 'Poslat vyúčtování', dueDate: '2026-04-30', contractId: contract.id }) });
    expect(created.status).toBe(201);
    const { reminder } = await created.json() as any;
    expect(reminder.propertyId).toBe(contract.propertyId); // derived from the contract
    expect(reminder.doneAt).toBeNull();

    await app.request('/api/reminders', { method: 'POST', headers: h, body: JSON.stringify({ title: 'Dřívější', dueDate: '2026-01-15' }) });

    const open = (await (await app.request('/api/reminders', { headers: h })).json() as any).reminders;
    expect(open.map((r: any) => r.title)).toEqual(['Dřívější', 'Poslat vyúčtování']);

    const done = await app.request(`/api/reminders/${reminder.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ done: true }) });
    expect(done.status).toBe(200);
    expect(((await done.json()) as any).reminder.doneAt).not.toBeNull();

    const openAfter = (await (await app.request('/api/reminders', { headers: h })).json() as any).reminders;
    expect(openAfter).toHaveLength(1);
    const all = (await (await app.request('/api/reminders?includeDone=1', { headers: h })).json() as any).reminders;
    expect(all).toHaveLength(2);

    const del = await app.request(`/api/reminders/${reminder.id}`, { method: 'DELETE', headers: h });
    expect(del.status).toBe(204);
    expect(await (await app.request(`/api/reminders/${reminder.id}`, { method: 'DELETE', headers: h })).status).toBe(404);

    await client.close();
  });

  it('rejects an empty title and a foreign contract', async () => {
    const { client, app, h } = await bootstrap();
    expect((await app.request('/api/reminders', { method: 'POST', headers: h, body: JSON.stringify({ title: '   ', dueDate: '2026-04-30' }) })).status).toBeGreaterThanOrEqual(400);
    expect((await app.request('/api/reminders', { method: 'POST', headers: h, body: JSON.stringify({ title: 'x', dueDate: '2026-04-30', contractId: 'nope' }) })).status).toBe(404);
    await client.close();
  });
});
