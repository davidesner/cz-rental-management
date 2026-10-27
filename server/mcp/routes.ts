import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
  verifyOAuthQueryParams,
} from '@better-auth/oauth-provider';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Auth } from '../../core/auth/better-auth.js';
import {
  agentDisplayName,
  authIssuer,
  isRegisteredRedirectUri,
  MCP_SCOPE,
  mcpResource,
  redirectKind,
} from '../../core/auth/mcp-oauth.js';
import type { DB } from '../../core/db/client.js';
import { oauthClient, user } from '../../core/db/schema.js';
import {
  bearerToken,
  createMcpAuthenticator,
  isAllowedOrigin,
  McpAuthUnavailable,
  mcpChallenge,
  mcpUnavailable,
  type McpPrincipal,
} from './auth.js';
import { createMcpHttpHandler, type InProcessFetch } from './handler.js';

/** What the consent screen shows about a pending authorization. */
export interface ConsentInfo {
  clientId: string;
  agentName: string;
  redirectHost: string;
  loopback: boolean;
  scopes: string[];
  user: { name: string; email: string; mustChangePassword: boolean };
}

/**
 * The AS metadata minus `dpop_signing_alg_values_supported`: `/mcp` refuses
 * DPoP-bound tokens, so the issuer must not invite clients to request them.
 */
function withoutDpop(serve: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const res = await serve(req);
    if (!res.ok) return res;
    const body = (await res.json()) as Record<string, unknown>;
    delete body['dpop_signing_alg_values_supported'];
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify(body), { status: res.status, headers });
  };
}

/** Largest `/mcp` request body accepted. */
export const MCP_MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface McpRouteDeps {
  auth: Auth;
  db: DB;
  baseURL: string;
  secret: string;
  production: boolean;
  dispatch: InProcessFetch;
}

/**
 * The remote MCP endpoint (`/mcp`, streamable HTTP) and the discovery
 * documents agents need to find its OAuth authorization server. Mounted before
 * the better-auth catch-all: two of its well-known paths are answered here.
 */
export function mcpRoutes(deps: McpRouteDeps) {
  const { auth, db, baseURL } = deps;
  const authenticate = createMcpAuthenticator({ auth, db, baseURL });
  const handler = createMcpHttpHandler(deps.dispatch, baseURL);
  const protectedResource = {
    resource: mcpResource(baseURL),
    authorization_servers: [authIssuer(baseURL)],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Rental management',
  };
  const authServerMetadata = withoutDpop(oauthProviderAuthServerMetadata(auth));
  const openIdConfig = withoutDpop(oauthProviderOpenIdConfigMetadata(auth));
  const invalidQuery = { error: { kind: 'bad_request', message: 'invalid authorization request' } } as const;

  return new Hono()
    // Before anything reads the body (the handler parses it to refuse
    // `subscriptions/listen`): a bounded, streamed read, also for chunked
    // requests without content-length. Same limit as the MCP SDK's default.
    .use('/mcp', bodyLimit({
      maxSize: MCP_MAX_BODY_BYTES,
      onError: (c) => c.json({ jsonrpc: '2.0', error: { code: -32600, message: 'Request body too large' }, id: null }, 413),
    }))
    .all('/mcp', async (c) => {
      if (!isAllowedOrigin(c.req.header('origin') ?? null, baseURL, deps.production)) {
        return c.json({ error: 'forbidden_origin' }, 403);
      }
      if (!bearerToken(c.req.raw)) return mcpChallenge(baseURL);
      let principal: McpPrincipal | null;
      try {
        principal = await authenticate(c.req.raw);
      } catch (e) {
        if (e instanceof McpAuthUnavailable) return mcpUnavailable();
        throw e;
      }
      if (!principal) return mcpChallenge(baseURL, 'invalid_token');
      return handler.fetch(c.req.raw, {
        authInfo: {
          token: principal.token,
          clientId: principal.clientId,
          scopes: principal.scopes,
          expiresAt: principal.expiresAt,
          resource: new URL(mcpResource(baseURL)),
          extra: { userId: principal.userId },
        },
      });
    })
    .get('/.well-known/oauth-protected-resource/mcp', (c) => c.json(protectedResource))
    .get('/.well-known/oauth-protected-resource', (c) => c.json(protectedResource))
    .get('/.well-known/oauth-authorization-server/api/auth', (c) => authServerMetadata(c.req.raw))
    .get('/.well-known/oauth-authorization-server', (c) => authServerMetadata(c.req.raw))
    .get('/.well-known/openid-configuration/api/auth', (c) => openIdConfig(c.req.raw))
    // better-auth serves these two under its base path as well; answered here
    // first so they carry the same (DPoP-free) document.
    .get('/api/auth/.well-known/openid-configuration', (c) => openIdConfig(c.req.raw))
    .get('/api/auth/.well-known/oauth-authorization-server', (c) => authServerMetadata(c.req.raw))
    // What the consent page shows. Everything comes from the signed query (what
    // the authorize endpoint validated) and the stored client, never from extra
    // parameters, so a crafted link cannot make the page lie about the agent.
    .get('/api/oauth/consent-info', async (c) => {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session) return c.json({ error: { kind: 'unauthenticated', message: 'no session' } }, 401);
      const oauthQuery = c.req.query('oauth_query') ?? '';
      if (!oauthQuery || !(await verifyOAuthQueryParams(oauthQuery, deps.secret))) {
        return c.json(invalidQuery, 400);
      }
      const query = new URLSearchParams(oauthQuery);
      const clientId = query.get('client_id') ?? '';
      const redirectUri = query.get('redirect_uri') ?? '';
      const [client] = await db
        .select({ name: oauthClient.name, redirectUris: oauthClient.redirectUris, disabled: oauthClient.disabled })
        .from(oauthClient)
        .where(eq(oauthClient.clientId, clientId))
        .limit(1);
      const kind = redirectKind(redirectUri);
      if (!client || client.disabled || !kind || !isRegisteredRedirectUri(client.redirectUris, redirectUri)) {
        return c.json(invalidQuery, 400);
      }
      const [me] = await db
        .select({ name: user.name, email: user.email, mustChangePassword: user.mustChangePassword })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1);
      if (!me) return c.json({ error: { kind: 'unauthenticated', message: 'no user' } }, 401);
      const info: ConsentInfo = {
        clientId,
        agentName: agentDisplayName(client),
        redirectHost: new URL(redirectUri).host,
        loopback: kind === 'loopback',
        scopes: (query.get('scope') ?? '').split(' ').filter(Boolean),
        user: me,
      };
      return c.json(info);
    });
}
