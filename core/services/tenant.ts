import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { tenant } from '../db/schema.js';
import { AppError } from '../errors.js';

export interface TenantInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  accountNumber?: string | null;
  note?: string | null;
}

export interface TenantRow {
  id: string;
  orgId: string;
  name: string;
  email: string | null;
  phone: string | null;
  accountNumber: string | null;
  note: string | null;
  createdAt: Date;
}

export async function createTenant(db: DB, orgId: string, input: TenantInput): Promise<TenantRow> {
  const id = createId();
  const [row] = await db.insert(tenant).values({
    id, orgId, name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
    accountNumber: input.accountNumber ?? null,
    note: input.note ?? null,
  }).returning();
  return row!;
}

export async function listTenants(db: DB, orgId: string): Promise<TenantRow[]> {
  return db.select().from(tenant).where(eq(tenant.orgId, orgId));
}

export async function getTenant(db: DB, orgId: string, id: string): Promise<TenantRow> {
  const row = await db.select().from(tenant).where(and(eq(tenant.id, id), eq(tenant.orgId, orgId))).then(rs => rs[0]);
  if (!row) throw new AppError('not_found', 'tenant not found');
  return row;
}

export async function updateTenant(db: DB, orgId: string, id: string, input: Partial<TenantInput>): Promise<TenantRow> {
  await getTenant(db, orgId, id);
  const patch: Record<string, unknown> = {};
  for (const key of ['name', 'email', 'phone', 'accountNumber', 'note'] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  if (Object.keys(patch).length === 0) return getTenant(db, orgId, id);
  const [row] = await db.update(tenant).set(patch).where(and(eq(tenant.id, id), eq(tenant.orgId, orgId))).returning();
  return row!;
}
