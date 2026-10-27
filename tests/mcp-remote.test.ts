import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';
import {
  APP,
  appFetch,
  beginAuthorization,
  CLAUDE_REDIRECT,
  mcpClient,
  obtainMcpToken,
  reachConsent,
  RESOURCE,
  resultJson,
  submitConsent,
} from './helpers/mcp-oauth.js';
import { oauthClient, session, user } from '../core/db/schema.js';

type Boot = Awaited<ReturnType<typeof boot>>;

const listToolsBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

function postMcp(accessToken: string, body: string) {
  return t.app.request(`${APP}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${accessToken}`,
    },
    body,
  });
}

async function boot() {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  await registerUser(app, 'alice@example.test', 'alice-password-1', 'Alice');
  await registerUser(app, 'bob@example.test', 'bob-password-12', 'Bob');
  return { db, client, app };
}

let t: Boot;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t?.client.close(); });

describe('remote MCP discovery', () => {
  it('serves the protected resource metadata for /mcp', async () => {
    const res = await t.app.request(`${APP}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [`${APP}/api/auth`],
      scopes_supported: ['rental'],
    });
  });

  it('serves the authorization server metadata without DPoP', async () => {
    const res = await t.app.request(`${APP}/.well-known/oauth-authorization-server/api/auth`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['issuer']).toBe(`${APP}/api/auth`);
    expect(typeof body['registration_endpoint']).toBe('string');
    expect(body).not.toHaveProperty('dpop_signing_alg_values_supported');
  });

  it('answers an unauthenticated /mcp with a 401 challenge that starts discovery', async () => {
    const res = await t.app.request(`${APP}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${APP}/.well-known/oauth-protected-resource/mcp", scope="rental"`,
    );
  });

  it('refuses a garbage bearer with invalid_token', async () => {
    const res = await t.app.request(`${APP}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer not.a.jwt' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('refuses a foreign Origin (DNS rebinding guard)', async () => {
    const res = await t.app.request(`${APP}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('keeps the session-to-JWT endpoint disabled', async () => {
    const res = await t.app.request(`${APP}/api/auth/token`);
    expect(res.status).toBe(404);
  });
});

describe('dynamic client registration', () => {
  const register = (body: Record<string, unknown>) =>
    t.app.request(`${APP}/api/auth/oauth2/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'x',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        ...body,
      }),
    });

  it('accepts the Claude callback', async () => {
    const res = await register({ redirect_uris: [CLAUDE_REDIRECT] });
    expect(res.status).toBeLessThan(300);
  });

  it('accepts a loopback callback (Claude Code, MCP Inspector)', async () => {
    const res = await register({ redirect_uris: ['http://localhost:53682/callback'] });
    expect(res.status).toBeLessThan(300);
  });

  it('refuses an arbitrary redirect URI', async () => {
    const res = await register({ redirect_uris: ['https://evil.example/callback'] });
    expect(res.status).toBe(400);
  });

  it('refuses mixing redirect kinds in one registration', async () => {
    const res = await register({ redirect_uris: [CLAUDE_REDIRECT, 'http://localhost:1/cb'] });
    expect(res.status).toBe(400);
  });

  it('refuses the client_credentials grant', async () => {
    const res = await register({ redirect_uris: [CLAUDE_REDIRECT], grant_types: ['client_credentials'] });
    expect(res.status).toBe(400);
  });
});

describe('OAuth flow', () => {
  it('issues an audience-bound JWT with the rental scope', async () => {
    const { claims, clientId, refreshToken } = await obtainMcpToken(t.app, 'alice@example.test', 'alice-password-1');
    const aud = claims['aud'];
    expect(Array.isArray(aud) ? aud : [aud]).toEqual([RESOURCE]);
    expect(claims['iss']).toBe(`${APP}/api/auth`);
    expect(claims['client_id']).toBe(clientId);
    expect(String(claims['scope']).split(' ')).toContain('rental');
    expect(Number(claims['exp']) - Number(claims['iat'])).toBe(900);
    expect(typeof refreshToken).toBe('string');
  });

  it('shows the consent page who is asking, from the redirect URI not the client name', async () => {
    const step = await reachConsent(t.app, 'alice@example.test', 'alice-password-1', { clientName: 'Totally Claude' });
    const res = await t.app.request(
      `${APP}/api/oauth/consent-info?oauth_query=${encodeURIComponent(step.consentQuery)}`,
      { headers: { cookie: step.cookie } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      agentName: 'Claude',
      redirectHost: 'claude.ai',
      loopback: false,
      user: { email: 'alice@example.test', mustChangePassword: false },
    });
  });

  it('refuses consent-info for a tampered query', async () => {
    const step = await reachConsent(t.app, 'alice@example.test', 'alice-password-1');
    const tampered = step.consentQuery.replace(/client_id=[^&]+/, 'client_id=other');
    const res = await t.app.request(
      `${APP}/api/oauth/consent-info?oauth_query=${encodeURIComponent(tampered)}`,
      { headers: { cookie: step.cookie } },
    );
    expect(res.status).toBe(400);
  });

  it('returns access_denied to the agent when consent is refused', async () => {
    const step = await reachConsent(t.app, 'alice@example.test', 'alice-password-1');
    const back = await submitConsent(t.app, step, false);
    expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_REDIRECT);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('code')).toBeNull();
  });

  it('refreshes the access token', async () => {
    const first = await obtainMcpToken(t.app, 'alice@example.test', 'alice-password-1');
    const res = await appFetch(t.app)(`${APP}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: first.refreshToken ?? '',
        client_id: first.clientId,
        resource: RESOURCE,
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string };
    const client = await mcpClient(t.app, body.access_token);
    const me = await client.callTool({ name: 'me_get', arguments: {} });
    expect(me.isError).toBeFalsy();
    await client.close();
  });

  it('refuses on /mcp a token that lacks the rental scope', async () => {
    const { accessToken, claims } = await obtainMcpToken(t.app, 'alice@example.test', 'alice-password-1', {
      scope: 'offline_access',
    });
    expect(String(claims['scope']).split(' ')).not.toContain('rental');
    const res = await t.app.request(`${APP}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
  });

  it('revokes the access token with its session on sign-out, while refresh keeps the agent connected', async () => {
    const first = await obtainMcpToken(t.app, 'alice@example.test', 'alice-password-1');
    const sid = first.claims['sid'];
    expect(typeof sid).toBe('string');
    await t.db.delete(session).where(eq(session.id, sid as string));
    expect((await postMcp(first.accessToken, listToolsBody)).status).toBe(401);

    const res = await appFetch(t.app)(`${APP}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: first.refreshToken ?? '',
        client_id: first.clientId,
        resource: RESOURCE,
      }).toString(),
    });
    expect(res.status).toBe(200);
    const { access_token } = (await res.json()) as { access_token: string };
    expect((await postMcp(access_token, listToolsBody)).status).toBe(200);
  });

  it('refuses an expired bound session', async () => {
    const { accessToken, claims } = await obtainMcpToken(t.app, 'alice@example.test', 'alice-password-1');
    await t.db.update(session).set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(session.id, claims['sid'] as string));
    expect((await postMcp(accessToken, listToolsBody)).status).toBe(401);
  });

  it('does not start without a registered client', async () => {
    await expect(beginAuthorization(t.app, { redirectUri: 'https://evil.example/cb' })).rejects.toThrow();
  });
});

describe('MCP tools over /mcp', () => {
  it('lists the same tools as the stdio server', async () => {
    const { accessToken } = await obtainMcpToken(t.app, 'alice@example.test', 'alice-password-1');
    const client = await mcpClient(t.app, accessToken);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      'me_get', 'properties_list', 'properties_create', 'contracts_list', 'payments_list', 'reconciliations_compute',
    ]));
    const create = tools.find((tool) => tool.name === 'properties_create');
    expect(create?.inputSchema).toMatchObject({ type: 'object', required: ['name'] });
    await client.close();
  });

  it('runs tools as the signed-in user, scoped to their organization', async () => {
    const alice = await mcpClient(t.app, (await obtainMcpToken(t.app, 'alice@example.test', 'alice-password-1')).accessToken);
    const bob = await mcpClient(t.app, (await obtainMcpToken(t.app, 'bob@example.test', 'bob-password-12')).accessToken);

    const me = resultJson(await alice.callTool({ name: 'me_get', arguments: {} }));
    expect(me).toMatchObject({ user: { email: 'alice@example.test' } });

    const created = await alice.callTool({ name: 'properties_create', arguments: { name: 'Byt <placeholder>' } });
    expect(created.isError).toBeFalsy();
    const property = resultJson(created) as { id: string; name: string };
    expect(property.name).toBe('Byt <placeholder>');

    const aliceList = resultJson(await alice.callTool({ name: 'properties_list', arguments: {} })) as Array<{ id: string }>;
    expect(aliceList.map((p) => p.id)).toContain(property.id);
    const bobList = resultJson(await bob.callTool({ name: 'properties_list', arguments: {} })) as Array<{ id: string }>;
    expect(bobList.map((p) => p.id)).not.toContain(property.id);

    const bobGet = await bob.callTool({ name: 'properties_get', arguments: { id: property.id } });
    expect(bobGet.isError).toBe(true);
    expect(resultJson(bobGet)).toMatchObject({ status: 404 });

    await alice.close();
    await bob.close();
  });

  it('refuses an oversized body before parsing it', async () => {
    const { accessToken } = await obtainMcpToken(t.app, 'alice@example.test', 'alice-password-1');
    const big = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'subscriptions/listen', params: { pad: 'x'.repeat(8 * 1024 * 1024) },
    });
    expect((await postMcp(accessToken, big)).status).toBe(413);
  });

  it('links the bank setup page on the public origin, not the in-process host', async () => {
    const { accessToken } = await obtainMcpToken(t.app, 'alice@example.test', 'alice-password-1');
    const client = await mcpClient(t.app, accessToken);
    const res = resultJson(await client.callTool({ name: 'bank_integrations_setup_url', arguments: {} }));
    expect(res).toMatchObject({ url: `${APP}/settings?tab=bank&action=new` });
    await client.close();
  });

  it('surfaces REST validation errors to the model as a tool error', async () => {
    const { accessToken } = await obtainMcpToken(t.app, 'alice@example.test', 'alice-password-1');
    const client = await mcpClient(t.app, accessToken);
    const res = await client.callTool({ name: 'properties_create', arguments: { name: '' } });
    expect(res.isError).toBe(true);
    await client.close();
  });

  it('does not accept an MCP access token on the REST API', async () => {
    const { accessToken } = await obtainMcpToken(t.app, 'alice@example.test', 'alice-password-1');
    const res = await t.app.request(`${APP}/api/properties`, { headers: { authorization: `Bearer ${accessToken}` } });
    expect(res.status).toBe(401);
  });

  it('cuts a disabled agent off on its next call', async () => {
    const { accessToken, clientId } = await obtainMcpToken(t.app, 'alice@example.test', 'alice-password-1');
    await t.db.update(oauthClient).set({ disabled: true }).where(eq(oauthClient.clientId, clientId));
    const res = await t.app.request(`${APP}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('keeps the forced password change in force for agents', async () => {
    const { accessToken } = await obtainMcpToken(t.app, 'bob@example.test', 'bob-password-12');
    await t.db.update(user).set({ mustChangePassword: true }).where(eq(user.email, 'bob@example.test'));
    try {
      const client = await mcpClient(t.app, accessToken);
      const res = await client.callTool({ name: 'properties_list', arguments: {} });
      expect(res.isError).toBe(true);
      expect(resultJson(res)).toMatchObject({ status: 403, error: { error: { kind: 'must_change_password' } } });
      await client.close();
    } finally {
      await t.db.update(user).set({ mustChangePassword: false }).where(eq(user.email, 'bob@example.test'));
    }
  });
});
