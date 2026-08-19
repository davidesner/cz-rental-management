/**
 * Applies pending migrations during a Vercel *preview* build.
 *
 * Production migrations stay manual on purpose (see DEPLOY.md) — a rebuild must never
 * reshape the production schema behind your back. Previews are different: the Neon Vercel
 * integration gives each preview deployment its own copy-on-write database branch, so the
 * schema there has to be brought up to date by something, and the build is the only place
 * that already knows which branch it got.
 *
 * Two conditions must BOTH hold, so this can never reach the production database:
 *   1. VERCEL_ENV === 'preview'      — set by the Vercel runtime, not by us.
 *   2. PREVIEW_DB_MIGRATIONS === '1' — opt-in, set ONLY on the Preview environment.
 *
 * Without the Neon integration installed, a preview deployment inherits the shared
 * DATABASE_URL from project settings — which would be production. Condition 2 is what
 * makes that unreachable by accident: if you never set it, this is a no-op.
 */
import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../core/db/client.js';

function skip(reason: string): never {
  console.log(`[migrate-preview] skipped — ${reason}`);
  process.exit(0);
}

// Trimmed: a value set through a pipe (`echo 1 | vercel env add`) keeps its trailing
// newline, and Vercel stores it verbatim — so an exact `=== '1'` silently skips.
const flag = process.env.PREVIEW_DB_MIGRATIONS?.trim();
const vercelEnv = process.env.VERCEL_ENV?.trim();

if (vercelEnv !== 'preview') {
  skip(`VERCEL_ENV is ${process.env.VERCEL_ENV ?? '<unset>'}, not "preview"`);
}
if (flag !== '1') {
  skip(
    `PREVIEW_DB_MIGRATIONS is ${JSON.stringify(process.env.PREVIEW_DB_MIGRATIONS ?? null)}, ` +
      'not "1" (set it on the Preview environment to enable)',
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
  if (!pooled) {
    console.error('[migrate-preview] neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set');
    process.exit(1);
  }
  return pooled.replace('-pooler.', '.');
}

const url = resolveDirectUrl();
// Redact credentials — Vercel build logs are visible to anyone who can see the deployment.
const safeUrl = url.replace(/\/\/[^@]*@/, '//<redacted>@');

// `serverless: false` explicitly: VERCEL=1 during the build would otherwise select the
// PgBouncer-safe pool (max 1, prepare false). This is a direct connection in a
// long-running build step, so it should behave exactly like a local `pnpm db:migrate`.
const { db, close } = createDb(url, { serverless: false });
try {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('[migrate-preview] migrations applied to', safeUrl);
} finally {
  await close();
}
