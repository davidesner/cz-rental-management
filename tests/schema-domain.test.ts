import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { sql } from 'drizzle-orm';

describe('domain schema', () => {
  it('creates property fields and all SCD2 tables', async () => {
    const { db, client } = await freshDb();
    const rows = await db.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename`
    );
    const names = rows.map((r) => r.tablename);
    for (const t of ['tenant', 'contract', 'contract_terms', 'contract_utility', 'property_service_tariff']) {
      expect(names).toContain(t);
    }
    // verify property has the new columns
    const cols = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='property'`
    );
    const colNames = cols.map((c) => c.column_name);
    expect(colNames).toContain('address');
    expect(colNames).toContain('reconciliation_skill');
    expect(colNames).toContain('note');
    await client.close();
  });
});
