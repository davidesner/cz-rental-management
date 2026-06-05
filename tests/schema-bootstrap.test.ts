import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { freshDb } from './helpers/db.js';

describe('schema bootstrap', () => {
  it('creates user/account/session tables', async () => {
    const { db, client } = await freshDb();
    const rows = await db.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const names = rows.map((r) => r.tablename);
    expect(names).toContain('user');
    expect(names).toContain('account');
    expect(names).toContain('session');
    expect(names).toContain('verification');
    await client.close();
  });
});
