import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export type DB = LibSQLDatabase<typeof schema>;

export function createDb(url: string): { db: DB; client: Client } {
  const client = createClient({ url });
  const db = drizzle(client, { schema });
  return { db, client };
}

export function createMemoryDb(): { db: DB; client: Client } {
  return createDb(':memory:');
}
