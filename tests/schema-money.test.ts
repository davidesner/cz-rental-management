import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { sql } from 'drizzle-orm';

describe('payments + cost_statement schema', () => {
  it('tables and unique index exist', async () => {
    const { db, client } = await freshDb();
    const tables = (await db.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public'`
    )).map((r) => r.tablename);
    expect(tables).toContain('payment');
    expect(tables).toContain('cost_statement');
    const idx = await db.execute<{ indexname: string }>(
      sql`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='payment'`
    );
    expect(idx.map((r) => r.indexname)).toContain('payment_org_external_idx');
    await client.close();
  });
});
