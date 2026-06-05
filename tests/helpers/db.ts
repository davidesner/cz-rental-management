// Disable Ryuk reaper — it hangs on macOS Docker Desktop (socket at non-standard path)
process.env['TESTCONTAINERS_RYUK_DISABLED'] = 'true';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../../core/db/schema.js';

export type DB = PostgresJsDatabase<typeof schema>;

let sharedContainer: StartedPostgreSqlContainer | null = null;
let sharedUrl: string | null = null;
let counter = 0;

export async function ensureContainer(): Promise<string> {
  if (!sharedContainer) {
    sharedContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    sharedUrl = sharedContainer.getConnectionUri();
  }
  return sharedUrl!;
}

export async function freshDb(): Promise<{ db: DB; client: { close: () => Promise<void> } }> {
  const baseUrl = await ensureContainer();
  const dbName = `test_${process.pid}_${++counter}`;

  // Create a fresh database for full isolation
  const admin = postgres(baseUrl, { max: 1 });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const testUrl = baseUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  const sql = postgres(testUrl, { max: 5 });
  const db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: './drizzle' });

  return {
    db,
    client: {
      close: async () => {
        await sql.end();
      },
    },
  };
}
