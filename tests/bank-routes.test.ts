import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';
import { bankIntegration, bankTransaction, membership, propertyAccess } from '../core/db/schema.js';
import { eq } from 'drizzle-orm';

beforeAll(() => {
  process.env['SECRET_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
  process.env['CRON_SECRET'] = 'test-cron-secret';
});

const json = (cookie: string) => ({ 'content-type': 'application/json', cookie });

async function bootstrap() {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, 'owner@example.com', 'password123', 'Owner');
  await app.request('/api/organizations', { method: 'POST', headers: json(cookie), body: JSON.stringify({ name: 'O' }) });
  const p = (await (await app.request('/api/properties', { method: 'POST', headers: json(cookie), body: JSON.stringify({ name: 'P' }) })).json() as any).property;
  const t = (await (await app.request('/api/tenants', { method: 'POST', headers: json(cookie), body: JSON.stringify({ name: 'T' }) })).json() as any).tenant;
  const ct = (await (await app.request('/api/contracts', { method: 'POST', headers: json(cookie), body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: '2024-09-01' }) })).json() as any).contract;
  return { db, client, app, cookie, property: p, contract: ct };
}

const INTEGRATION = {
  name: 'KB', imapHost: 'imap.example.com', imapUser: 'u@example.com',
  imapPassword: 'app-password', accountNumber: '321-9876543210/0100',
};

describe('bank integration routes', () => {
  it('creates, lists, updates and deletes — never exposing the password', async () => {
    const { client, app, cookie } = await bootstrap();

    const create = await app.request('/api/bank-integrations', { method: 'POST', headers: json(cookie), body: JSON.stringify(INTEGRATION) });
    expect(create.status).toBe(201);
    const body = await create.text();
    // The single most important assertion in this file.
    expect(body).not.toContain('app-password');
    expect(body).not.toContain('imapPasswordEnc');
    const integration = JSON.parse(body).bankIntegration;
    expect(integration.imapPasswordSet).toBe(true);
    expect(integration.imapPort).toBe(993);
    expect(integration.subjectFilter).toBe('Přijali jsme platbu');

    const list = await app.request('/api/bank-integrations', { headers: { cookie } });
    expect(await list.clone().text()).not.toContain('app-password');
    expect((await list.json() as any).bankIntegrations).toHaveLength(1);

    // Omitting the password leaves the stored one untouched
    const patch = await app.request(`/api/bank-integrations/${integration.id}`, {
      method: 'PATCH', headers: json(cookie), body: JSON.stringify({ name: 'KB hlavní' }),
    });
    expect(patch.status).toBe(200);
    expect((await patch.json() as any).bankIntegration.name).toBe('KB hlavní');

    const del = await app.request(`/api/bank-integrations/${integration.id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(204);
    await client.close();
  });

  it('rejects a restricted member from the integration and inbox endpoints', async () => {
    const { db, client, app, cookie, property, contract } = await bootstrap();
    const integration = (await (await app.request('/api/bank-integrations', { method: 'POST', headers: json(cookie), body: JSON.stringify(INTEGRATION) })).json() as any).bankIntegration;

    // A pending transaction, seeded directly like withTransaction() below —
    // needed to exercise the assign/ignore gates, the two most dangerous
    // routes (assign creates a payment; ignore is irreversible).
    const txId = createId();
    await db.insert(bankTransaction).values({
      id: txId, orgId: integration.orgId,
      integrationId: integration.id, messageId: 'm1',
      amount: 3_800_000, currency: 'CZK', valueDate: '2026-08-20',
      fromAccount: '294153028/0300', toAccount: '321-9876543210/0100',
      status: 'unmatched', receivedAt: new Date(),
    });

    // A member scoped to the one property
    const { userId } = await registerUser(app, 'member@example.com', 'password123', 'Member');
    const login = await app.request('/api/auth/sign-in/email', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member@example.com', password: 'password123' }),
    });
    const memberCookie = login.headers.get('set-cookie') ?? '';
    const [org] = await db.select().from(membership);
    const memberMembership = createId();
    await db.insert(membership).values({ id: memberMembership, userId, orgId: org!.orgId, role: 'member' });
    await db.insert(propertyAccess).values({ membershipId: memberMembership, propertyId: property.id });

    // x-org-id selects the shared org membership — without it, the request
    // defaults to the member's own auto-created personal org (where signup's
    // databaseHooks made them owner), which would trivially pass requireOwner
    // against an empty org instead of actually exercising the restriction. See
    // tests/property-access.test.ts and tests/payments.test.ts for the same pattern.
    const memberHeaders = { cookie: memberCookie, 'x-org-id': org!.orgId };
    expect((await app.request('/api/bank-integrations', { headers: memberHeaders })).status).toBe(403);
    expect((await app.request('/api/bank-transactions', { headers: memberHeaders })).status).toBe(403);

    expect((await app.request(`/api/bank-transactions/${txId}/assign`, {
      method: 'POST', headers: { ...memberHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ contractId: contract.id }),
    })).status).toBe(403);
    expect((await app.request(`/api/bank-transactions/${txId}/ignore`, {
      method: 'POST', headers: memberHeaders,
    })).status).toBe(403);

    // /sync and /test are gated before any network call: requireOwner throws
    // before getBankIntegration or bankKey() are ever reached.
    expect((await app.request(`/api/bank-integrations/${integration.id}/sync`, {
      method: 'POST', headers: memberHeaders,
    })).status).toBe(403);
    expect((await app.request(`/api/bank-integrations/${integration.id}/test`, {
      method: 'POST', headers: memberHeaders,
    })).status).toBe(403);
    await client.close();
  });

  it('404s on another org\'s integration', async () => {
    const { client, app, cookie } = await bootstrap();
    const mine = (await (await app.request('/api/bank-integrations', { method: 'POST', headers: json(cookie), body: JSON.stringify(INTEGRATION) })).json() as any).bankIntegration;

    const other = await registerUser(app, 'other@example.com', 'password123', 'Other');
    await app.request('/api/organizations', { method: 'POST', headers: json(other.cookie), body: JSON.stringify({ name: 'O2' }) });

    const res = await app.request(`/api/bank-integrations/${mine.id}`, { headers: { cookie: other.cookie } });
    expect(res.status).toBe(404);

    // /sync and /test resolve ownership BEFORE touching IMAP — for another
    // org's integration this must 404 without ever reaching the network.
    const sync = await app.request(`/api/bank-integrations/${mine.id}/sync`, { method: 'POST', headers: { cookie: other.cookie } });
    expect(sync.status).toBe(404);
    const test = await app.request(`/api/bank-integrations/${mine.id}/test`, { method: 'POST', headers: { cookie: other.cookie } });
    expect(test.status).toBe(404);
    await client.close();
  });
});

describe('payment rule routes', () => {
  it('upserts, reads with health, and deletes', async () => {
    const { client, app, cookie, contract } = await bootstrap();

    const empty = await app.request(`/api/contracts/${contract.id}/payment-rule`, { headers: { cookie } });
    expect(empty.status).toBe(200);
    const emptyBody = await empty.json() as any;
    expect(emptyBody.rule).toBeNull();
    expect(emptyBody.health.state).toBe('nenastaveno');

    const put = await app.request(`/api/contracts/${contract.id}/payment-rule`, {
      method: 'PUT', headers: json(cookie),
      body: JSON.stringify({ counterpartyAccount: '294153028/0300', amountFrom: 3_500_000, amountTo: 4_120_000 }),
    });
    expect(put.status).toBe(200);
    expect((await put.json() as any).rule.amountFrom).toBe(3_500_000);

    // Upsert is idempotent — a second PUT updates rather than violating the
    // one-rule-per-contract constraint
    const put2 = await app.request(`/api/contracts/${contract.id}/payment-rule`, {
      method: 'PUT', headers: json(cookie), body: JSON.stringify({ vs: '2026008' }),
    });
    expect(put2.status).toBe(200);
    const rule2 = (await put2.json() as any).rule;
    expect(rule2.vs).toBe('2026008');
    expect(rule2.counterpartyAccount).toBeNull(); // PUT replaces, it does not merge

    // Still nenastaveno — a rule without an integration cannot pair anything
    const withRule = await (await app.request(`/api/contracts/${contract.id}/payment-rule`, { headers: { cookie } })).json() as any;
    expect(withRule.health.state).toBe('nenastaveno');

    await app.request('/api/bank-integrations', { method: 'POST', headers: json(cookie), body: JSON.stringify(INTEGRATION) });
    const healthy = await (await app.request(`/api/contracts/${contract.id}/payment-rule`, { headers: { cookie } })).json() as any;
    expect(healthy.health.state).toBe('ok');

    const del = await app.request(`/api/contracts/${contract.id}/payment-rule`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(204);
    await client.close();
  });

  it('rejects a rule with no criteria', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    const res = await app.request(`/api/contracts/${contract.id}/payment-rule`, {
      method: 'PUT', headers: json(cookie), body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    expect((await res.json() as any).error.message).toMatch(/alespoň jedno kritérium/);
    await client.close();
  });

  it('rejects an inverted amount band', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    const res = await app.request(`/api/contracts/${contract.id}/payment-rule`, {
      method: 'PUT', headers: json(cookie), body: JSON.stringify({ amountFrom: 500, amountTo: 100 }),
    });
    expect(res.status).toBe(422);
    await client.close();
  });
});

describe('bank transaction routes', () => {
  async function withTransaction() {
    const ctx = await bootstrap();
    const integration = (await (await ctx.app.request('/api/bank-integrations', { method: 'POST', headers: json(ctx.cookie), body: JSON.stringify(INTEGRATION) })).json() as any).bankIntegration;
    const txId = createId();
    await ctx.db.insert(bankTransaction).values({
      id: txId, orgId: (await ctx.db.select().from(bankIntegration))[0]!.orgId,
      integrationId: integration.id, messageId: 'm1',
      amount: 3_800_000, currency: 'CZK', valueDate: '2026-08-20',
      fromAccount: '294153028/0300', toAccount: '321-9876543210/0100',
      status: 'unmatched', receivedAt: new Date(),
    });
    return { ...ctx, txId };
  }

  it('lists pending transactions and assigns one to a contract', async () => {
    const { client, app, cookie, contract, txId, db } = await withTransaction();

    const list = await app.request('/api/bank-transactions?pending=1', { headers: { cookie } });
    expect(list.status).toBe(200);
    expect((await list.json() as any).bankTransactions).toHaveLength(1);

    const assign = await app.request(`/api/bank-transactions/${txId}/assign`, {
      method: 'POST', headers: json(cookie), body: JSON.stringify({ contractId: contract.id }),
    });
    expect(assign.status).toBe(200);
    const assigned = (await assign.json() as any).bankTransaction;
    expect(assigned.status).toBe('matched');
    expect(assigned.matchedBy).toBe('manual');
    expect(assigned.paymentId).not.toBeNull();
    expect(assigned.contractId).toBe(contract.id);

    // It leaves the pending list once paired
    const after = await (await app.request('/api/bank-transactions?pending=1', { headers: { cookie } })).json() as any;
    expect(after.bankTransactions).toHaveLength(0);

    // Assigning twice conflicts
    const again = await app.request(`/api/bank-transactions/${txId}/assign`, {
      method: 'POST', headers: json(cookie), body: JSON.stringify({ contractId: contract.id }),
    });
    expect(again.status).toBe(409);

    // Deleting the payment returns it to the inbox — paymentId is the truth
    const [tx] = await db.select().from(bankTransaction).where(eq(bankTransaction.id, txId));
    await app.request(`/api/payments/${tx!.paymentId}`, { method: 'DELETE', headers: { cookie } });
    const reopened = await (await app.request('/api/bank-transactions?pending=1', { headers: { cookie } })).json() as any;
    expect(reopened.bankTransactions).toHaveLength(1);
    await client.close();
  });

  // A query param is a thing a user can edit in the address bar, and this branch
  // introduces the repo's first query-param parse. A ZodError here used to reach
  // errorMiddleware's generic branch as an HTTP 500.
  it('treats an unrecognised ?status as no filter instead of a 500', async () => {
    const { client, app, cookie } = await withTransaction();
    const res = await app.request('/api/bank-transactions?status=nonsense', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json() as any).bankTransactions).toHaveLength(1);

    // A recognised one still filters.
    const filtered = await app.request('/api/bank-transactions?status=matched', { headers: { cookie } });
    expect((await filtered.json() as any).bankTransactions).toHaveLength(0);
    await client.close();
  });

  it('ignores a transaction', async () => {
    const { client, app, cookie, txId } = await withTransaction();
    const res = await app.request(`/api/bank-transactions/${txId}/ignore`, { method: 'POST', headers: json(cookie), body: '{}' });
    expect(res.status).toBe(200);
    expect((await res.json() as any).bankTransaction.status).toBe('ignored');
    const list = await (await app.request('/api/bank-transactions?pending=1', { headers: { cookie } })).json() as any;
    expect(list.bankTransactions).toHaveLength(0);
    await client.close();
  });
});

describe('cron endpoint', () => {
  it('refuses without the secret', async () => {
    const { client, app } = await bootstrap();
    expect((await app.request('/api/cron/bank-sync')).status).toBe(401);
    expect((await app.request('/api/cron/bank-sync', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await app.request('/api/cron/bank-sync', { headers: { authorization: 'Bearer ' } })).status).toBe(401);
    await client.close();
  });

  it('accepts the correct secret and reports per-integration results', async () => {
    const { client, app } = await bootstrap();
    const res = await app.request('/api/cron/bank-sync', { headers: { authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results).toEqual([]); // no integrations in this fresh org
    await client.close();
  });

  it('refuses everything when CRON_SECRET is unset — never runs open', async () => {
    const saved = process.env['CRON_SECRET'];
    delete process.env['CRON_SECRET'];
    try {
      const { client, app } = await bootstrap();
      expect((await app.request('/api/cron/bank-sync', { headers: { authorization: 'Bearer anything' } })).status).toBe(401);
      await client.close();
    } finally {
      process.env['CRON_SECRET'] = saved;
    }
  });
});
