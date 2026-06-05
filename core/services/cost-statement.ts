import { createId } from '@paralleldrive/cuid2';
import { and, eq, gte, lte, asc } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { costStatement, property } from '../db/schema.js';
import { AppError } from '../errors.js';

export type CostKind = 'services' | 'electricity' | 'gas' | 'internet' | 'water' | 'other';

export interface CostStatementInput {
  propertyId: string;
  kind: CostKind;
  periodFrom: string;
  periodTo: string;
  totalAmount: number;
  adjustmentAmount?: number;
  adjustmentNote?: string | null;
  documentRef?: string | null;
  issuedAt?: string | null;
  note?: string | null;
}

export interface CostStatementRow {
  id: string;
  orgId: string;
  propertyId: string;
  kind: CostKind;
  periodFrom: string;
  periodTo: string;
  totalAmount: number;
  adjustmentAmount: number;
  adjustmentNote: string | null;
  documentRef: string | null;
  issuedAt: string | null;
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

export async function createCostStatement(db: DB, orgId: string, allowedPropertyIds: string[] | null, input: CostStatementInput): Promise<CostStatementRow> {
  await assertPropertyInOrg(db, orgId, input.propertyId, allowedPropertyIds);
  const id = createId();
  const [row] = await db.insert(costStatement).values({
    id, orgId,
    propertyId: input.propertyId,
    kind: input.kind,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    totalAmount: input.totalAmount,
    adjustmentAmount: input.adjustmentAmount ?? 0,
    adjustmentNote: input.adjustmentNote ?? null,
    documentRef: input.documentRef ?? null,
    issuedAt: input.issuedAt ?? null,
    note: input.note ?? null,
  }).returning();
  return row! as CostStatementRow;
}

export interface ListCostFilters {
  propertyId?: string;
  kind?: CostKind;
  from?: string;
  to?: string;
}

export async function listCostStatements(db: DB, orgId: string, allowedPropertyIds: string[] | null, filters: ListCostFilters): Promise<CostStatementRow[]> {
  const conds = [eq(costStatement.orgId, orgId)];
  if (filters.propertyId) conds.push(eq(costStatement.propertyId, filters.propertyId));
  if (filters.kind) conds.push(eq(costStatement.kind, filters.kind));
  if (filters.from) conds.push(gte(costStatement.periodTo, filters.from));
  if (filters.to) conds.push(lte(costStatement.periodFrom, filters.to));
  let rows = await db.select().from(costStatement).where(and(...conds)).orderBy(asc(costStatement.periodFrom));
  if (allowedPropertyIds !== null) {
    rows = rows.filter(s => allowedPropertyIds.includes(s.propertyId));
  }
  return rows as CostStatementRow[];
}

export async function getCostStatement(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<CostStatementRow> {
  const [row] = await db.select().from(costStatement).where(and(eq(costStatement.id, id), eq(costStatement.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'statement not found');
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(row.propertyId)) {
    throw new AppError('forbidden', 'no access');
  }
  return row as CostStatementRow;
}

export async function updateCostStatement(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null, patch: Partial<CostStatementInput>): Promise<CostStatementRow> {
  await getCostStatement(db, orgId, id, allowedPropertyIds);
  const cleaned: Record<string, unknown> = {};
  for (const k of ['kind', 'periodFrom', 'periodTo', 'totalAmount', 'adjustmentAmount', 'adjustmentNote', 'documentRef', 'issuedAt', 'note'] as const) {
    if ((patch as any)[k] !== undefined) cleaned[k] = (patch as any)[k];
  }
  if (Object.keys(cleaned).length === 0) return getCostStatement(db, orgId, id, allowedPropertyIds);
  const [row] = await db.update(costStatement).set(cleaned).where(and(eq(costStatement.id, id), eq(costStatement.orgId, orgId))).returning();
  return row! as CostStatementRow;
}

export async function deleteCostStatement(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<void> {
  await getCostStatement(db, orgId, id, allowedPropertyIds);
  await db.delete(costStatement).where(and(eq(costStatement.id, id), eq(costStatement.orgId, orgId)));
}
