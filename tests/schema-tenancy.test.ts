import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { freshDb } from './helpers/db.js';

describe('tenancy schema', () => {
  it('creates organization/membership/property/property_access/api_token tables', async () => {
    const { db, client } = await freshDb();
    const rows = await db.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const names = rows.map((r) => r.tablename);
    for (const t of ['organization', 'membership', 'property', 'property_access', 'api_token']) {
      expect(names).toContain(t);
    }
    await client.close();
  });
});
