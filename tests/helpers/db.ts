// Tests use the local docker-compose Postgres (rental-pg) — NOT testcontainers.
// Each test creates a fresh database in the shared Postgres and drops it on close,
// so nothing accumulates between runs.

import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../../core/db/schema.js';

export type DB = PostgresJsDatabase<typeof schema>;

// Connect to admin DB by default — tests will CREATE their own per-test database.
const BASE_URL = process.env['TEST_DATABASE_URL']
  ?? 'postgresql://postgres:postgres@localhost:5432/postgres';

let counter = 0;

/** Compatibility export — kept for tests/setup.ts that pre-loads it. No-op container start. */
export async function ensureContainer(): Promise<string> {
  return BASE_URL;
}

export async function freshDb(): Promise<{ db: DB; client: { close: () => Promise<void> } }> {
  const dbName = `test_${process.pid}_${++counter}_${Date.now()}`;

  // Create a fresh database via the admin connection
  const admin = postgres(BASE_URL, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const testUrl = BASE_URL.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  const sql = postgres(testUrl, { max: 5 });
  const db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: './drizzle' });

  return {
    db,
    client: {
      close: async () => {
        // Close the test connection, then drop the test database to leave no residue.
        await sql.end();
        try {
          const cleanup = postgres(BASE_URL, { max: 1 });
          // Force-drop in case other connections linger (libsql/postgres can be slow to release)
          await cleanup.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
          await cleanup.end();
        } catch {
          // Best-effort cleanup; if it fails (e.g. server crashed mid-test), leave it.
        }
      },
    },
  };
}
