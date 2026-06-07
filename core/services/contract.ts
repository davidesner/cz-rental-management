import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { contract, property, tenant } from '../db/schema.js';
import { AppError } from '../errors.js';

export interface ContractInput {
  propertyId: string;
  tenantId: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null;
  securityDeposit?: number | null; // haléře
  note?: string | null;
  paymentDueDay?: number | null;
  paymentAppliesTo?: 'current' | 'next' | null;
}

export interface ContractRow {
  id: string;
  orgId: string;
  propertyId: string;
  tenantId: string;
  startDate: string;
  endDate: string | null;
  securityDeposit: number | null;
  note: string | null;
  paymentDueDay: number;
  paymentAppliesTo: 'current' | 'next';
  createdAt: Date;
}

async function verifyOwnership(db: DB, orgId: string, propertyId: string, tenantId: string) {
  const [p] = await db.select().from(property).where(and(eq(property.id, propertyId), eq(property.orgId, orgId)));
  if (!p) throw new AppError('not_found', 'property not in org');
  const [t] = await db.select().from(tenant).where(and(eq(tenant.id, tenantId), eq(tenant.orgId, orgId)));
  if (!t) throw new AppError('not_found', 'tenant not in org');
}

export async function createContract(db: DB, orgId: string, input: ContractInput): Promise<ContractRow> {
  await verifyOwnership(db, orgId, input.propertyId, input.tenantId);
  const id = createId();
  const [row] = await db.insert(contract).values({
    id, orgId,
    propertyId: input.propertyId,
    tenantId: input.tenantId,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    securityDeposit: input.securityDeposit ?? null,
    note: input.note ?? null,
    paymentDueDay: input.paymentDueDay ?? 10,
    paymentAppliesTo: input.paymentAppliesTo ?? 'current',
  }).returning();
  return row!;
}

export async function listContracts(db: DB, orgId: string, allowedPropertyIds: string[] | null): Promise<ContractRow[]> {
  const rows = await db.select().from(contract).where(eq(contract.orgId, orgId));
  if (allowedPropertyIds === null) return rows;
  return rows.filter(r => allowedPropertyIds.includes(r.propertyId));
}

export async function getContract(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<ContractRow> {
  const [row] = await db.select().from(contract).where(and(eq(contract.id, id), eq(contract.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'contract not found');
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(row.propertyId)) {
    throw new AppError('forbidden', 'no access to contract\'s property');
  }
  return row;
}

export async function updateContract(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null, input: Partial<Omit<ContractInput, 'propertyId' | 'tenantId'>>): Promise<ContractRow> {
  await getContract(db, orgId, id, allowedPropertyIds);
  const patch: Record<string, unknown> = {};
  for (const key of ['startDate', 'endDate', 'securityDeposit', 'note', 'paymentDueDay', 'paymentAppliesTo'] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  if (Object.keys(patch).length === 0) return getContract(db, orgId, id, allowedPropertyIds);
  const [row] = await db.update(contract).set(patch).where(and(eq(contract.id, id), eq(contract.orgId, orgId))).returning();
  return row!;
}
