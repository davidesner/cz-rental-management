// Drives the remote MCP OAuth flow through `app.request`, the way Claude or
// ChatGPT would: discovery, dynamic client registration, PKCE authorize,
// password sign-in carrying the signed query, consent, token exchange.

import { randomBytes } from 'node:crypto';
import {
  Client,
  discoverOAuthServerInfo,
  exchangeAuthorization,
  registerClient,
  startAuthorization,
  StreamableHTTPClientTransport,
  type AuthorizationServerMetadata,
  type FetchLike,
  type OAuthClientInformationFull,
} from '@modelcontextprotocol/client';
import type { Hono } from 'hono';
import type { AppEnv } from '../../server/app.js';
import { oauthQueryFromLocation } from '../../src/lib/oauth.js';

type AppHono = Hono<AppEnv>;

export const APP = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
export const RESOURCE = `${APP}/mcp`;
export const CLAUDE_REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

/** `fetch` into the app. */
export function appFetch(app: AppHono): FetchLike {
  return (url, init) => Promise.resolve(app.request(String(url), init));
}

export interface FlowOptions {
  redirectUri?: string;
  clientName?: string;
  /** Requested scopes; the MCP scope plus refresh by default. */
  scope?: string;
}

export interface Authorization {
  authorizationServerUrl: string;
  metadata: AuthorizationServerMetadata | undefined;
  clientInformation: OAuthClientInformationFull;
  clientId: string;
  codeVerifier: string;
  redirectUri: string;
  /** The signed query the authorize endpoint put on the `/login` redirect. */
  loginQuery: string;
}

/** Discovery, DCR and the authorize request, up to the redirect to `/login`. */
export async function beginAuthorization(app: AppHono, opts: FlowOptions = {}): Promise<Authorization> {
  const fetchFn = appFetch(app);
  const redirectUri = opts.redirectUri ?? CLAUDE_REDIRECT;
  const info = await discoverOAuthServerInfo(RESOURCE, { fetchFn });
  const metadata = info.authorizationServerMetadata;
  const clientInformation = await registerClient(info.authorizationServerUrl, {
    metadata,
    clientMetadata: {
      client_name: opts.clientName ?? 'Claude',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    fetchFn,
  });
  const { authorizationUrl, codeVerifier } = await startAuthorization(info.authorizationServerUrl, {
    metadata,
    clientInformation,
    redirectUrl: redirectUri,
    scope: opts.scope ?? 'rental offline_access',
    state: randomBytes(8).toString('hex'),
    resource: new URL(RESOURCE),
  });
  const res = await fetchFn(authorizationUrl);
  const location = res.headers.get('location');
  if (res.status !== 302 || !location) throw new Error(`authorize: expected a redirect to /login, got ${res.status}`);
  const loginUrl = new URL(location, APP);
  if (loginUrl.pathname !== '/login') throw new Error(`authorize: redirected to ${loginUrl.pathname}`);
  const loginQuery = oauthQueryFromLocation(loginUrl.search);
  if (!loginQuery) throw new Error('authorize: the /login redirect carries no signed query');
  return {
    authorizationServerUrl: info.authorizationServerUrl,
    metadata,
    clientInformation,
    clientId: clientInformation.client_id,
    codeVerifier,
    redirectUri,
    loginQuery,
  };
}

/** The `name=value` pairs of every cookie a response sets. */
export function cookieHeader(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

/** Where a 302 or a better-auth `{ redirect: true, url }` answer points. */
export async function redirectTarget(res: Response): Promise<URL> {
  const location = res.headers.get('location');
  if (res.status === 302 && location) return new URL(location, APP);
  if (res.status === 200) {
    const body = (await res.json()) as { redirect?: boolean; url?: string };
    if (body.redirect && body.url) return new URL(body.url, APP);
  }
  throw new Error(`expected a redirect, got ${res.status}`);
}

export interface ConsentStep extends Authorization {
  cookie: string;
  consentQuery: string;
}

/** POST /sign-in/email with the signed query, as the login page does. */
export function signInWithOAuthQuery(app: AppHono, email: string, password: string, oauthQuery: string) {
  return app.request(`${APP}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP },
    body: JSON.stringify({ email, password, oauth_query: oauthQuery }),
  });
}

/** The whole flow up to the consent screen: signed in, with the consent page's signed query. */
export async function reachConsent(app: AppHono, email: string, password: string, opts: FlowOptions = {}): Promise<ConsentStep> {
  const flow = await beginAuthorization(app, opts);
  const res = await signInWithOAuthQuery(app, email, password, flow.loginQuery);
  const cookie = cookieHeader(res);
  const target = await redirectTarget(res);
  if (target.pathname !== '/oauth/consent') throw new Error(`sign-in: continued to ${target.pathname}`);
  const consentQuery = oauthQueryFromLocation(target.search);
  if (!consentQuery) throw new Error('sign-in: the consent redirect carries no signed query');
  return { ...flow, cookie, consentQuery };
}

/** POST /oauth2/consent as the consent page does; returns the redirect back to the agent. */
export async function submitConsent(app: AppHono, step: ConsentStep, accept: boolean): Promise<URL> {
  const res = await app.request(`${APP}/api/auth/oauth2/consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: APP, cookie: step.cookie },
    body: JSON.stringify({ accept, oauth_query: step.consentQuery }),
  });
  return redirectTarget(res);
}

/** The payload of a JWT, unverified. */
export function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('not a JWT');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/** Runs the full OAuth flow and returns the tokens the agent would hold. */
export async function obtainMcpToken(app: AppHono, email: string, password: string, opts: FlowOptions = {}) {
  const step = await reachConsent(app, email, password, opts);
  const back = await submitConsent(app, step, true);
  const code = back.searchParams.get('code');
  if (!code) throw new Error(`consent: no code (${back.searchParams.get('error') ?? 'no error'})`);
  const tokens = await exchangeAuthorization(step.authorizationServerUrl, {
    metadata: step.metadata,
    clientInformation: step.clientInformation,
    authorizationCode: code,
    iss: back.searchParams.get('iss') ?? undefined,
    codeVerifier: step.codeVerifier,
    redirectUri: step.redirectUri,
    resource: new URL(RESOURCE),
    fetchFn: appFetch(app),
  });
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    clientId: step.clientId,
    claims: decodeJwt(tokens.access_token),
  };
}

/** An MCP SDK client connected to the app's `/mcp` with `accessToken`. */
export async function mcpClient(app: AppHono, accessToken: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    fetch: appFetch(app),
  });
  const client = new Client({ name: 'rental-test', version: '0.0.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(transport);
  return client;
}

/** The text of a tool result's first content block, parsed as JSON when it is JSON. */
export function resultJson(result: { content: unknown }): unknown {
  const first = (result.content as Array<{ type: string; text?: string }>)[0];
  const text = first?.type === 'text' ? first.text ?? '' : '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
