import { verifyJwsAccessToken } from 'better-auth/oauth2';
import { eq } from 'drizzle-orm';
import type { Auth } from '../../core/auth/better-auth.js';
import { authIssuer, JWT_ALG, MCP_SCOPE, mcpResource, protectedResourceMetadataUrl } from '../../core/auth/mcp-oauth.js';
import type { DB } from '../../core/db/client.js';
import { oauthClient, user } from '../../core/db/schema.js';

/** Who is calling `/mcp`, from a verified access token and fresh database rows. */
export interface McpPrincipal {
  userId: string;
  clientId: string;
  scopes: string[];
  token: string;
  expiresAt: number;
}

/**
 * Token verification could not run (the JWKS could not be loaded): a server
 * fault, answered 503, never a token rejection.
 */
export class McpAuthUnavailable extends Error {
  constructor(options: { cause: unknown }) {
    super('MCP token verification unavailable', options);
    this.name = 'McpAuthUnavailable';
  }
}

/** jose failures that say nothing about the token: the key set could not be loaded or used. */
const JWKS_INFRASTRUCTURE_CODES = new Set(['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS']);

/**
 * Whether a verification failure is about the token itself (401). jose errors
 * carry a `code` (`ERR_JWT_*`, `ERR_JWS_*`, `ERR_JOSE_*`, `ERR_JWK*`); a
 * malformed token fails header decoding with a `TypeError`. Anything else,
 * and the JWKS infrastructure codes, is a server fault.
 */
function isTokenFault(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^ERR_J(WT|WS|OSE|WK)/.test(code) && !JWKS_INFRASTRUCTURE_CODES.has(code);
}

const BEARER = /^Bearer +([A-Za-z0-9\-._~+/]+=*) *$/i;

/** The bearer token of the `Authorization` header (RFC 6750 2.1), `null` without one. */
export function bearerToken(req: Request): string | null {
  return BEARER.exec(req.headers.get('authorization') ?? '')?.[1] ?? null;
}

/**
 * Authenticates an MCP request in-process: the JWT is verified against the
 * server's own JWKS (no HTTP self-fetch) for the issuer and the `/mcp`
 * audience, only `JWT_ALG` is accepted, it must carry the MCP scope and must
 * not be DPoP-bound (`cnf`, which a bearer check cannot honour). A token fault
 * resolves to `null` (401); a JWKS that cannot be loaded throws
 * `McpAuthUnavailable` (503).
 *
 * Then, on every call, the user row must still exist and the OAuth client must
 * exist and not be disabled (`pnpm mcp:clients revoke`), so revoking an agent
 * takes effect on its next call, not when its access token expires.
 *
 * Organization, role and property access are NOT decided here: the tools call
 * the REST API in-process as this user, and the API's auth middleware resolves
 * them exactly as for a browser session (server/middleware/auth.ts).
 */
export function createMcpAuthenticator(deps: { auth: Auth; db: DB; baseURL: string }) {
  const { auth, db, baseURL } = deps;
  const jwksFetch = () => auth.api.getJwks();

  return async (req: Request): Promise<McpPrincipal | null> => {
    const token = bearerToken(req);
    if (!token) return null;

    let payload: Awaited<ReturnType<typeof verifyJwsAccessToken>>;
    try {
      payload = await verifyJwsAccessToken(token, {
        jwksFetch,
        jwksCacheKey: auth,
        verifyOptions: { issuer: authIssuer(baseURL), audience: mcpResource(baseURL), algorithms: [JWT_ALG] },
      });
    } catch (e) {
      if (isTokenFault(e)) return null;
      console.error('[mcp] token verification unavailable', e);
      throw new McpAuthUnavailable({ cause: e });
    }
    if (payload['cnf'] !== undefined) return null;
    const scopes = typeof payload['scope'] === 'string' ? payload['scope'].split(' ').filter(Boolean) : [];
    if (!scopes.includes(MCP_SCOPE)) return null;
    const userId = payload.sub;
    const clientId = payload['client_id'];
    const expiresAt = payload.exp;
    if (typeof userId !== 'string' || !userId || typeof clientId !== 'string' || !clientId) return null;
    if (typeof expiresAt !== 'number') return null;

    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
    if (!row) return null;
    const [client] = await db
      .select({ disabled: oauthClient.disabled })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1);
    if (!client || client.disabled === true) return null;

    return { userId, clientId, scopes, token, expiresAt };
  };
}

/**
 * The 401 that starts OAuth discovery: `WWW-Authenticate` points to the
 * protected resource metadata and names the scope to request; a token that was
 * presented but refused adds `error="invalid_token"`.
 */
export function mcpChallenge(baseURL: string, error?: 'invalid_token'): Response {
  const parts = [`resource_metadata="${protectedResourceMetadataUrl(baseURL)}"`, `scope="${MCP_SCOPE}"`];
  if (error) parts.push(`error="${error}"`);
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': `Bearer ${parts.join(', ')}` },
  });
}

/** The answer when token verification itself failed (JWKS unavailable): retry later, no challenge. */
export function mcpUnavailable(): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Temporarily unavailable' }, id: null }),
    { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '5' } },
  );
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * DNS-rebinding guard of the streamable HTTP transport: no `Origin`
 * (server-to-server agents like Claude and ChatGPT send none) passes; otherwise
 * it must be the app's own origin, or outside production an `http` loopback
 * origin on any port (the MCP Inspector).
 */
export function isAllowedOrigin(origin: string | null, baseURL: string, production: boolean): boolean {
  if (origin === null) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (origin === new URL(baseURL).origin) return true;
  return !production && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}
