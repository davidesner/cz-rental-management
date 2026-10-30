import 'dotenv/config';
import { mcp } from '@better-auth/mcp';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { jwt } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema.js';
import { createOrganization } from '../services/organization.js';
import {
  checkClientRegistration,
  DISABLED_AUTH_PATHS,
  JWT_ALG,
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  MCP_SCOPE,
  mcpResource,
  RegistrationRejected,
  REGISTER_RATE_LIMIT,
} from './mcp-oauth.js';

function requireEnv(name: string, minLength = 0): string {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(
      `${name} must be set${minLength > 0 ? ` to at least ${minLength} chars` : ''}. ` +
      (name === 'BETTER_AUTH_SECRET' ? 'Generate with: openssl rand -base64 32' : ''),
    );
  }
  return value;
}

export function resolveTrustedOrigins(baseURL: string): string[] {
  const explicit = process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const isLocal = baseURL.startsWith('http://localhost') || baseURL.startsWith('http://127.0.0.1');
  if (explicit.length === 0 && (isLocal || process.env.VITEST)) {
    return ['http://localhost:5173', 'http://localhost:3000'];
  }
  // On Vercel a deployment is reachable on TWO generated hostnames, and Better
  // Auth's CSRF check compares the request's Origin against this list:
  //   VERCEL_URL        per-deployment alias, app-<hash>-<team>.vercel.app
  //   VERCEL_BRANCH_URL branch alias,         app-git-<branch>-<team>.vercel.app
  // Both must be trusted. Only VERCEL_URL used to be, so opening a preview by
  // its branch alias — the link in the PR, and the one people actually click —
  // failed sign-in with 403 "Invalid origin". It hid well: the origin check
  // only runs on requests that carry cookies, so curl and the health check
  // never tripped it while every real browser did.
  //
  // VERCEL_PROJECT_PRODUCTION_URL is deliberately NOT included. It is set even
  // in previews, so adding it would let the production origin post to a
  // preview's auth API for no benefit — production is already covered by
  // BETTER_AUTH_URL, which arrives here as baseURL.
  const vercelHosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
    .filter((h): h is string => Boolean(h))
    .map((h) => `https://${h}`);
  if (vercelHosts.length > 0) {
    return [...new Set([...explicit, ...vercelHosts, baseURL])];
  }
  if (explicit.length > 0) return explicit;
  throw new Error(
    'BETTER_AUTH_TRUSTED_ORIGINS must be set when BETTER_AUTH_URL is not localhost ' +
    '(comma-separated list of origins allowed to call the auth API).',
  );
}

/**
 * The app's public origin. Prefer an explicit BETTER_AUTH_URL. On Vercel
 * preview deployments where it isn't set (each preview has a distinct URL),
 * fall back to the per-deployment VERCEL_URL that Vercel auto-populates.
 *
 * It also names the remote MCP resource (`<baseURL>/mcp`) and the OAuth
 * issuer, so it must be exactly the origin agents are given.
 */
export function resolveBaseUrl(): string {
  const explicitBaseUrl = process.env.BETTER_AUTH_URL;
  const vercelUrl = process.env.VERCEL_URL;
  return explicitBaseUrl
    ?? (vercelUrl ? `https://${vercelUrl}` : requireEnv('BETTER_AUTH_URL'));
}

export function createAuth(db: DB) {
  const secret = requireEnv('BETTER_AUTH_SECRET', 32);
  const baseURL = resolveBaseUrl();
  const resource = mcpResource(baseURL);
  const trustedOrigins = resolveTrustedOrigins(baseURL);

  // Sign-up is disabled in production (manual user provisioning via scripts/create-user.ts).
  // Tests must keep signup working — the test suite has 60+ usages of /api/auth/sign-up/email.
  const allowSignup = Boolean(process.env.VITEST);

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        account: schema.account,
        session: schema.session,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
        jwks: schema.jwks,
        oauthClient: schema.oauthClient,
        oauthResource: schema.oauthResource,
        oauthClientResource: schema.oauthClientResource,
        oauthRefreshToken: schema.oauthRefreshToken,
        oauthAccessToken: schema.oauthAccessToken,
        oauthConsent: schema.oauthConsent,
        oauthClientAssertion: schema.oauthClientAssertion,
      },
    }),
    secret,
    baseURL,
    trustedOrigins,
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowSignup,
      requireEmailVerification: false,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        mustChangePassword: {
          type: 'boolean',
          required: false,
          defaultValue: false,
          input: false, // can't be set via signUpEmail body; only writable from server-side code
        },
      },
    },
    rateLimit: {
      enabled: !process.env.VITEST, // disable in tests to avoid flakes from shared per-test state
      window: 60,
      max: 100,
      storage: 'database',
      modelName: 'rateLimit',
    },
    disabledPaths: [...DISABLED_AUTH_PATHS],
    plugins: [
      // Signs the MCP access tokens. No session JWT in a `set-auth-jwt` header:
      // the only JWTs this app issues are OAuth access tokens.
      jwt({ disableSettingJwtHeader: true, jwks: { keyPairConfig: { alg: JWT_ALG, crv: 'Ed25519' } } }),
      // OAuth 2.1 authorization server for the remote MCP endpoint (server/mcp/).
      // The login page resumes the flow by posting the signed `oauth_query`
      // with the sign-in; the consent page is src/pages/OAuthConsent.tsx.
      mcp({
        resource,
        loginPage: '/login',
        consentPage: '/oauth/consent',
        scopes: ['openid', 'profile', 'email', 'offline_access', MCP_SCOPE],
        resources: [{ identifier: resource, allowedScopes: [MCP_SCOPE, 'offline_access'] }],
        // The resource row is seeded once (default `insertOnly`). A release that
        // changes `allowedScopes` above must deploy once with
        // `resourceSeedMode: 'merge'`, or the stored row keeps the old scopes.
        resourceSeedMode: 'insertOnly',
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: 'infer',
        accessTokenExpiresIn: MCP_ACCESS_TOKEN_TTL_SECONDS,
        rateLimit: { register: REGISTER_RATE_LIMIT },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/oauth2/register') return;
        try {
          checkClientRegistration(ctx.body);
        } catch (e) {
          if (!(e instanceof RegistrationRejected)) throw e;
          throw new APIError('BAD_REQUEST', { error: e.error, error_description: `rejected: ${e.field}` });
        }
      }),
    },
    advanced: {
      useSecureCookies: !baseURL.startsWith('http://localhost') && !baseURL.startsWith('http://127.0.0.1'),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Auto-create a personal organization for every new user.
            // Multi-user sharing (invites) comes later; for now user === org.
            await createOrganization(db, {
              userId: user.id,
              name: `${user.name}'s workspace`,
            });
          },
        },
      },
      account: {
        update: {
          // Clear mustChangePassword whenever a credential account's password
          // column changes — fires from Better Auth's /change-password endpoint.
          // We don't gate on which fields changed: in practice only the
          // change-password flow updates a credential account row, and clearing
          // the flag idempotently is harmless.
          after: async (account) => {
            if (account.providerId !== 'credential') return;
            await db.update(schema.user)
              .set({ mustChangePassword: false })
              .where(eq(schema.user.id, account.userId));
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
