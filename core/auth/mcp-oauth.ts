// Policy of the OAuth authorization server behind the remote MCP endpoint.
//
// Pure functions + constants, no better-auth import: core/auth/better-auth.ts
// wires them into the plugin config, server/mcp/ uses them on the resource side.

/** The one resource scope an MCP access token must carry. */
export const MCP_SCOPE = 'rental';

/**
 * The algorithm the jwt plugin signs access tokens with (its default, made
 * explicit). `/mcp` verifies with exactly this algorithm, so a key of another
 * kind in the JWKS can never vouch for a token.
 */
export const JWT_ALG = 'EdDSA';

/** Access-token lifetime. Short: the agent refreshes with its refresh token. */
export const MCP_ACCESS_TOKEN_TTL_SECONDS = 900;

/** Dynamic client registrations allowed per client IP and window. */
export const REGISTER_RATE_LIMIT = { window: 3600, max: 20 };

/** The MCP protected resource; access tokens are audience-bound to it. */
export function mcpResource(baseURL: string): string {
  return `${baseURL}/mcp`;
}

/** The OAuth issuer: better-auth's base URL including its base path. */
export function authIssuer(baseURL: string): string {
  return `${baseURL}/api/auth`;
}

/** RFC 9728 protected-resource metadata document of `/mcp`. */
export function protectedResourceMetadataUrl(baseURL: string): string {
  return `${baseURL}/.well-known/oauth-protected-resource/mcp`;
}

/**
 * better-auth endpoints answered with 404. `/token` is the jwt plugin's
 * session-to-JWT endpoint (an access token must come from the OAuth flow only,
 * otherwise any XSS on the app could mint one); the rest is the provider's HTTP
 * client management. Agents are managed with `pnpm mcp:clients`.
 */
export const DISABLED_AUTH_PATHS = [
  '/token',
  '/oauth2/create-client',
  '/oauth2/update-client',
  '/oauth2/delete-client',
  '/oauth2/client/rotate-secret',
  '/oauth2/client/rotate-keys',
];

// ----- redirect URIs dynamic client registration accepts -----

/**
 * One registration holds one kind only, so the agent name shown on the consent
 * screen is derived from the redirect host, never from the client-supplied
 * `client_name` (any registrant can call itself "Claude").
 */
export type RedirectKind = 'claude' | 'chatgpt' | 'loopback';

const FIXED_REDIRECTS: Record<string, RedirectKind> = {
  'https://claude.ai/api/mcp/auth_callback': 'claude',
  'https://claude.com/api/mcp/auth_callback': 'claude',
  'https://chatgpt.com/connector_platform_oauth_redirect': 'chatgpt',
};

const CHATGPT_CALLBACK_PATH = /^\/connector\/oauth\/[A-Za-z0-9_-]+$/;

// Claude Code and the MCP Inspector listen on one of these with a random port.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

function parseUrl(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

/** The agent kind of an allowed redirect URI, `null` when it is not allowed. */
export function redirectKind(uri: string): RedirectKind | null {
  // A redirect URI never carries a fragment (RFC 6749 3.1.2), not even an empty one.
  if (uri.includes('#')) return null;
  const url = parseUrl(uri);
  if (!url || url.username !== '' || url.password !== '') return null;

  const fixed = FIXED_REDIRECTS[url.href];
  if (fixed) return fixed;

  if (
    url.protocol === 'https:'
    && url.hostname === 'chatgpt.com'
    && url.port === ''
    && url.search === ''
    && CHATGPT_CALLBACK_PATH.test(url.pathname)
  ) {
    return 'chatgpt';
  }

  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return 'loopback';
  return null;
}

/** A loopback redirect URI with its port removed, `null` for any other URI. */
function withoutLoopbackPort(uri: string): string | null {
  if (redirectKind(uri) !== 'loopback') return null;
  return uri.replace(/^(http:\/\/[^/?#:]+)(?::\d*)?(?=[/?#]|$)/, '$1');
}

/**
 * Whether a requested redirect URI is one the client registered: exact, except
 * that a loopback one may differ in the port only (RFC 8252 7.3), as the
 * authorize endpoint matches it.
 */
export function isRegisteredRedirectUri(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const bare = withoutLoopbackPort(requested);
  return bare !== null && registered.some((uri) => withoutLoopbackPort(uri) === bare);
}

/** The agent's display name, from its registered redirect URI kind (see RedirectKind). */
export function agentDisplayName(client: { name: string | null; redirectUris: string[] }): string {
  const first = client.redirectUris[0];
  const kind = first === undefined ? null : redirectKind(first);
  if (kind === 'claude') return 'Claude';
  if (kind === 'chatgpt') return 'ChatGPT';
  return `${client.name?.trim() || 'Lokální aplikace'} (tento počítač)`;
}

// ----- dynamic client registration checks -----

export class RegistrationRejected extends Error {
  constructor(public readonly error: 'invalid_redirect_uri' | 'invalid_client_metadata', public readonly field: string) {
    super(`${error}: ${field}`);
    this.name = 'RegistrationRejected';
  }
}

const ALLOWED_GRANT_TYPES = new Set(['authorization_code', 'refresh_token']);
const ALLOWED_AUTH_METHODS = new Set(['none', 'client_secret_basic', 'client_secret_post']);
/** Logout and client-key metadata: an agent needs none of it. */
const REFUSED_METADATA_FIELDS = ['post_logout_redirect_uris', 'backchannel_logout_uri', 'jwks', 'jwks_uri'] as const;

function isCanonicalUrl(uri: string): boolean {
  return parseUrl(uri)?.href === uri;
}

/** Present with a value; `null` and an empty list count as absent (the provider then applies its defaults). */
function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
}

/**
 * Throws RegistrationRejected unless the `/oauth2/register` body is an
 * authorization-code client (optionally with refresh), authenticating with no
 * secret or a client secret, with no logout endpoints or client keys, and with
 * at least one redirect URI, all allowed, of one kind, in canonical form.
 */
export function checkClientRegistration(body: unknown): void {
  const meta = (body ?? {}) as Record<string, unknown>;
  const grants = meta['grant_types'];
  if (isSet(grants) && (!Array.isArray(grants) || grants.some((g) => !ALLOWED_GRANT_TYPES.has(g as string)))) {
    throw new RegistrationRejected('invalid_client_metadata', 'grant_types');
  }
  const method = meta['token_endpoint_auth_method'];
  if (isSet(method) && !ALLOWED_AUTH_METHODS.has(method as string)) {
    throw new RegistrationRejected('invalid_client_metadata', 'token_endpoint_auth_method');
  }
  for (const field of REFUSED_METADATA_FIELDS) {
    if (isSet(meta[field])) throw new RegistrationRejected('invalid_client_metadata', field);
  }

  const uris = meta['redirect_uris'];
  const kinds = Array.isArray(uris)
    ? uris.map((u) => (typeof u === 'string' && isCanonicalUrl(u) ? redirectKind(u) : null))
    : [];
  if (kinds.length === 0 || kinds.some((k) => k === null || k !== kinds[0])) {
    throw new RegistrationRejected('invalid_redirect_uri', 'redirect_uris');
  }
}
