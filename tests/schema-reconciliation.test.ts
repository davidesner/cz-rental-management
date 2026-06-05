import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { sql } from 'drizzle-orm';

describe('reconciliation schema', () => {
  it('tables exist', async () => {
    const { db, client } = await freshDb();
    const tables = (await db.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public'`
    )).map((r) => r.tablename);
    expect(tables).toContain('reconciliation');
    expect(tables).toContain('reconciliation_item');
    await client.close();
  });
});
