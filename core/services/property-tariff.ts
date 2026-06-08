import { createId } from '@paralleldrive/cuid2';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { propertyServiceTariff, property } from '../db/schema.js';
import { AppError } from '../errors.js';

export interface CreateTariffInput {
  validFrom: string;
  totalSvjAdvance: number;
  deductibleAmount: number;
  deductibleNote?: string | null;
  documentRef?: string | null;
  note?: string | null;
}

export interface TariffRow {
  id: string;
  propertyId: string;
  validFrom: string;
  validTo: string | null;
  totalSvjAdvance: number;
  deductibleAmount: number;
  deductibleNote: string | null;
  documentRef: string | null;
  note: string | null;
  createdAt: Date;
}

async function assertPropertyInOrg(db: DB, orgId: string, propertyId: string, allowedPropertyIds: string[] | null) {
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(propertyId)) {
    throw new AppError('forbidden', 'no access');
  }
  const [p] = await db.select().from(property).where(and(eq(property.id, propertyId), eq(property.orgId, orgId)));
  if (!p) throw new AppError('not_found', 'property not in org');
}

export async function addPropertyTariff(db: DB, orgId: string, propertyId: string, allowedPropertyIds: string[] | null, input: CreateTariffInput): Promise<TariffRow> {
  await assertPropertyInOrg(db, orgId, propertyId, allowedPropertyIds);
  return db.transaction(async (tx) => {
    await tx.update(propertyServiceTariff)
      .set({ validTo: input.validFrom })
      .where(and(eq(propertyServiceTariff.propertyId, propertyId), isNull(propertyServiceTariff.validTo)));
    const id = createId();
    const [row] = await tx.insert(propertyServiceTariff).values({
      id, propertyId,
      validFrom: input.validFrom, validTo: null,
      totalSvjAdvance: input.totalSvjAdvance,
      deductibleAmount: input.deductibleAmount,
      deductibleNote: input.deductibleNote ?? null,
      documentRef: input.documentRef ?? null,
      note: input.note ?? null,
    }).returning();
    return row!;
  });
}

export async function listPropertyTariffs(db: DB, orgId: string, propertyId: string, allowedPropertyIds: string[] | null): Promise<TariffRow[]> {
  await assertPropertyInOrg(db, orgId, propertyId, allowedPropertyIds);
  return db.select().from(propertyServiceTariff).where(eq(propertyServiceTariff.propertyId, propertyId)).orderBy(asc(propertyServiceTariff.validFrom));
}
