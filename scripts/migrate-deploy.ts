/**
 * Applies pending migrations during a Vercel build, for preview and production.
 *
 * Why in the build rather than a separate CI job: Vercel only promotes a deployment
 * after its build succeeds, so migrating here guarantees the ordering — schema is
 * current before the new code serves a single request, and a failed migration fails
 * the build and leaves the previous deployment live. A CI job running alongside the
 * deploy races it, and can let new code hit an old schema.
 *
 * Each environment needs its own explicit opt-in, so this can never fire somewhere
 * it wasn't intended:
 *
 *   VERCEL_ENV=preview     + PREVIEW_DB_MIGRATIONS=1     (scope: Preview)
 *   VERCEL_ENV=production  + PRODUCTION_DB_MIGRATIONS=1  (scope: Production)
 *
 * The preview opt-in matters because without the Neon integration's per-deployment
 * branching, a preview inherits the production DATABASE_URL — the flag is what makes
 * that unreachable by accident. The production opt-in is the kill switch: unset it and
 * deploys stop touching the schema, with no code change.
 *
 * Migrations are forward-only. Rolling a deployment back does not roll the schema back;
 * that stays a manual operation against the direct connection.
 */
import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../core/db/client.js';

function skip(reason: string): never {
  console.log(`[migrate-deploy] skipped — ${reason}`);
  process.exit(0);
}

function fail(reason: string): never {
  console.error(`[migrate-deploy] ${reason}`);
  process.exit(1);
}

// Trimmed: a value piped into `vercel env add` keeps its trailing newline and Vercel
// stores it verbatim, so an exact `=== '1'` would silently skip.
const env = process.env.VERCEL_ENV?.trim();

const targets = {
  preview: 'PREVIEW_DB_MIGRATIONS',
  production: 'PRODUCTION_DB_MIGRATIONS',
} as const;

if (env !== 'preview' && env !== 'production') {
  skip(`VERCEL_ENV is ${process.env.VERCEL_ENV ?? '<unset>'}, neither "preview" nor "production"`);
}

const flagName = targets[env];
const flag = process.env[flagName]?.trim();
if (flag !== '1') {
  skip(
    `${flagName} is ${JSON.stringify(process.env[flagName] ?? null)}, not "1" ` +
      `(set it on the ${env} environment to enable)`,
  );
}

/**
 * drizzle's migrator runs DDL in a transaction, which PgBouncer transaction mode rejects
 * ("cannot execute outside of a transaction block"), so migrations need the direct
 * connection. The Neon integration exposes it as DATABASE_URL_UNPOOLED; if only the pooled
 * URL is present, Neon's direct host is the same name minus the `-pooler` suffix.
 */
function resolveDirectUrl(): string {
  const unpooled = process.env.DATABASE_URL_UNPOOLED;
  if (unpooled) return unpooled;

  const pooled = process.env.DATABASE_URL;
  if (!pooled) fail('neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set');
  return pooled.replace('-pooler.', '.');
}

const url = resolveDirectUrl();
// Redact credentials — build logs are visible to anyone who can see the deployment.
const safeUrl = url.replace(/\/\/[^@]*@/, '//<redacted>@');

// `serverless: false` explicitly: VERCEL=1 during the build would otherwise select the
// PgBouncer-safe pool (max 1, prepare false). This is a direct connection in a
// long-running build step, so it should behave exactly like a local `pnpm db:migrate`.
const { db, close } = createDb(url, { serverless: false });
try {
  console.log(`[migrate-deploy] applying migrations to ${env} at ${safeUrl}`);
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log(`[migrate-deploy] ${env} schema is up to date`);
} finally {
  await close();
}
