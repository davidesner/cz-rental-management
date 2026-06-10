import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type DB = PostgresJsDatabase<typeof schema>;

/**
 * Create a Drizzle DB client wrapping `postgres-js`.
 *
 * Pool sizing strategy:
 * - **Local / long-running server** (node.ts): `max: 10` connections, normal prepared statements.
 * - **Serverless** (Vercel functions, detected via `VERCEL` env): `max: 1` per instance
 *   (instances are short-lived, no point pooling within one), `prepare: false` for
 *   PgBouncer / Neon pooled-connection compatibility (prepared statements break in
 *   transaction-mode pooling because each query may land on a different backend).
 */
export function createDb(url: string, opts?: { serverless?: boolean }): { db: DB; close: () => Promise<void> } {
  const isServerless = opts?.serverless ?? Boolean(process.env.VERCEL);
  const client = postgres(url, isServerless
    ? { max: 1, prepare: false, idle_timeout: 20 }
    : { max: 10 }
  );
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}
