// Disable Ryuk reaper — it hangs on macOS Docker Desktop (socket at non-standard path)
process.env['TESTCONTAINERS_RYUK_DISABLED'] = 'true';

import { readFileSync } from 'node:fs';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../../core/db/schema.js';

export type DB = PostgresJsDatabase<typeof schema>;

let sharedContainer: StartedPostgreSqlContainer | null = null;
let sharedUrl: string | null = null;
let counter = 0;

// Path used to share the container URL between the globalSetup process and test workers.
const URL_FILE = '/tmp/vitest-postgres-url.txt';

export async function ensureContainer(): Promise<string> {
  if (sharedUrl) return sharedUrl;
  // Check if globalSetup already started a container and wrote its URL to a file.
  try {
    const url = readFileSync(URL_FILE, 'utf8').trim();
    if (url) {
      sharedUrl = url;
      return sharedUrl;
    }
  } catch {
    // file not present yet — fall through to start a container
  }
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
