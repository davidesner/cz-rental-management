import { createId } from '@paralleldrive/cuid2';
import { and, eq, inArray } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { property } from '../db/schema.js';
import { AppError } from '../errors.js';

export interface PropertyInput {
  name: string;
  address?: string | null;
  reconciliationSkill?: string | null;
  note?: string | null;
}

export interface PropertyRow {
  id: string;
  orgId: string;
  name: string;
  address: string | null;
  reconciliationSkill: string | null;
  note: string | null;
  createdAt: Date;
}

export async function createProperty(db: DB, orgId: string, input: PropertyInput): Promise<PropertyRow> {
  const id = createId();
  const [row] = await db.insert(property).values({
    id, orgId, name: input.name,
    address: input.address ?? null,
    reconciliationSkill: input.reconciliationSkill ?? null,
    note: input.note ?? null,
  }).returning();
  return row!;
}

export async function listProperties(db: DB, orgId: string, allowedIds: string[] | null): Promise<PropertyRow[]> {
  if (allowedIds !== null && allowedIds.length === 0) return [];
  const conds = [eq(property.orgId, orgId)];
  if (allowedIds !== null) conds.push(inArray(property.id, allowedIds));
  return db.select().from(property).where(and(...conds));
}

export async function getProperty(db: DB, orgId: string, id: string, allowedIds: string[] | null): Promise<PropertyRow> {
  if (allowedIds !== null && !allowedIds.includes(id)) {
    throw new AppError('forbidden', 'no access to property');
  }
  const row = await db.select().from(property).where(and(eq(property.id, id), eq(property.orgId, orgId))).then(rs => rs[0]);
  if (!row) throw new AppError('not_found', 'property not found');
  return row;
}

export async function updateProperty(db: DB, orgId: string, id: string, allowedIds: string[] | null, input: Partial<PropertyInput>): Promise<PropertyRow> {
  await getProperty(db, orgId, id, allowedIds); // existence + scope
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.address !== undefined) patch.address = input.address;
  if (input.reconciliationSkill !== undefined) patch.reconciliationSkill = input.reconciliationSkill;
  if (input.note !== undefined) patch.note = input.note;
  if (Object.keys(patch).length === 0) return getProperty(db, orgId, id, allowedIds);
  const [row] = await db.update(property).set(patch).where(and(eq(property.id, id), eq(property.orgId, orgId))).returning();
  return row!;
}

// Keep the legacy export so prior Plan 1 callers (if any) still compile.
export async function createPropertyStub(db: DB, orgId: string, name: string) {
  return createProperty(db, orgId, { name });
}
