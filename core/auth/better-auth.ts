import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema.js';
import { createOrganization } from '../services/organization.js';

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

function resolveTrustedOrigins(baseURL: string): string[] {
  const env = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean);
  // No env override. Only acceptable in tests / local dev — otherwise refuse to boot,
  // because Better Auth's CSRF check would reject every browser request from prod.
  const isLocal = baseURL.startsWith('http://localhost') || baseURL.startsWith('http://127.0.0.1');
  if (!isLocal && !process.env.VITEST) {
    throw new Error(
      'BETTER_AUTH_TRUSTED_ORIGINS must be set when BETTER_AUTH_URL is not localhost ' +
      '(comma-separated list of origins allowed to call the auth API).',
    );
  }
  return ['http://localhost:5173', 'http://localhost:3000'];
}

export function createAuth(db: DB) {
  const secret = requireEnv('BETTER_AUTH_SECRET', 32);
  const baseURL = requireEnv('BETTER_AUTH_URL');
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
