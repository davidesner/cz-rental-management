import { describe, it, expect } from 'vitest';
import { createMemoryDb } from '../core/db/client.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { sql } from 'drizzle-orm';

describe('tenancy schema', () => {
  it('creates organization/membership/property/property_access/api_token tables', async () => {
    const { db, client } = createMemoryDb();
    await migrate(db, { migrationsFolder: './drizzle' });
    const rows = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    );
    const names = rows.map((r) => r.name);
    for (const t of ['organization', 'membership', 'property', 'property_access', 'api_token']) {
      expect(names).toContain(t);
    }
    client.close();
  });
});
