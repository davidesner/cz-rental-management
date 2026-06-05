import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema.js';

export function createAuth(db: DB) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        account: schema.account,
        session: schema.session,
        verification: schema.verification,
      },
    }),
    secret: process.env.BETTER_AUTH_SECRET ?? 'dev-secret-do-not-use',
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    // Vite dev server proxies /api → :3000, but origin header is :5173
    trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
      ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(',')
      : ['http://localhost:5173'],
    emailAndPassword: { enabled: true, requireEmailVerification: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
