import { describe, it, expect } from 'vitest';
import { createMemoryDb } from '../core/db/client.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { sql } from 'drizzle-orm';

describe('schema bootstrap', () => {
  it('creates user/account/session tables', async () => {
    const { db, client } = createMemoryDb();
    await migrate(db, { migrationsFolder: './drizzle' });
    const rows = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    );
    const names = rows.map((r) => r.name);
    expect(names).toContain('user');
    expect(names).toContain('account');
    expect(names).toContain('session');
    expect(names).toContain('verification');
    client.close();
  });
});
