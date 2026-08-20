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
  createdAt: Date;
  propertyName: string;
  tenantName: string;
}

async function verifyOwnership(db: DB, orgId: string, propertyId: string, tenantId: string, allowedPropertyIds: string[] | null) {
  const [p] = await db.select().from(property).where(and(eq(property.id, propertyId), eq(property.orgId, orgId)));
  if (!p) throw new AppError('not_found', 'property not in org');
  // Org membership is not access: a `member` is scoped to specific properties.
  // Without this, a restricted member could create a contract on any property
  // in the org — and then read back its name through the joined row.
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(propertyId)) {
    throw new AppError('forbidden', 'no access to property');
  }
  const [t] = await db.select().from(tenant).where(and(eq(tenant.id, tenantId), eq(tenant.orgId, orgId)));
  if (!t) throw new AppError('not_found', 'tenant not in org');
}

export async function createContract(db: DB, orgId: string, allowedPropertyIds: string[] | null, input: ContractInput): Promise<ContractRow> {
  await verifyOwnership(db, orgId, input.propertyId, input.tenantId, allowedPropertyIds);
  const id = createId();
  await db.insert(contract).values({
    id, orgId,
    propertyId: input.propertyId,
    tenantId: input.tenantId,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    securityDeposit: input.securityDeposit ?? null,
    note: input.note ?? null,
  });
  // .returning() from the insert wouldn't include the joined names, so
  // re-fetch through getContract. Pass the caller's own allowedPropertyIds
  // rather than null: verifyOwnership has already established access, so this
  // cannot refuse a legitimate create, and re-asserting it here means the two
  // checks can never drift apart.
  return getContract(db, orgId, id, allowedPropertyIds);
}

// contract.propertyId / tenantId are NOT NULL with ON DELETE restrict, so the
// joined rows always exist — innerJoin keeps the names non-nullable. A leftJoin
// here would force `string | null` on fields that can never be null.
const contractSelect = {
  id: contract.id,
  orgId: contract.orgId,
  propertyId: contract.propertyId,
  tenantId: contract.tenantId,
  startDate: contract.startDate,
  endDate: contract.endDate,
  securityDeposit: contract.securityDeposit,
  note: contract.note,
  createdAt: contract.createdAt,
  propertyName: property.name,
  tenantName: tenant.name,
};

export async function listContracts(db: DB, orgId: string, allowedPropertyIds: string[] | null): Promise<ContractRow[]> {
  const rows = await db
    .select(contractSelect)
    .from(contract)
    .innerJoin(property, eq(property.id, contract.propertyId))
    .innerJoin(tenant, eq(tenant.id, contract.tenantId))
    .where(eq(contract.orgId, orgId));
  if (allowedPropertyIds === null) return rows;
  return rows.filter(r => allowedPropertyIds.includes(r.propertyId));
}

export async function getContract(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<ContractRow> {
  const [row] = await db
    .select(contractSelect)
    .from(contract)
    .innerJoin(property, eq(property.id, contract.propertyId))
    .innerJoin(tenant, eq(tenant.id, contract.tenantId))
    .where(and(eq(contract.id, id), eq(contract.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'contract not found');
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(row.propertyId)) {
    throw new AppError('forbidden', 'no access to contract\'s property');
  }
  return row;
}

export async function updateContract(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null, input: Partial<Omit<ContractInput, 'propertyId' | 'tenantId'>>): Promise<ContractRow> {
  await getContract(db, orgId, id, allowedPropertyIds);
  const patch: Record<string, unknown> = {};
  for (const key of ['startDate', 'endDate', 'securityDeposit', 'note'] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  if (Object.keys(patch).length === 0) return getContract(db, orgId, id, allowedPropertyIds);
  await db.update(contract).set(patch).where(and(eq(contract.id, id), eq(contract.orgId, orgId)));
  // Same reasoning as createContract: .update().returning() wouldn't include
  // the joined names, and access was already verified above.
  return getContract(db, orgId, id, allowedPropertyIds);
}
