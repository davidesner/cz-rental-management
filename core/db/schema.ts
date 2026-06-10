import { boolean, date, integer, pgTable, text, timestamp, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';

// ----- better-auth tables (names match better-auth defaults) -----

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  accountId: text('account_id').notNull(),
  password: text('password'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerUser: uniqueIndex('account_provider_user_idx').on(t.providerId, t.accountId),
}));

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- tenancy tables -----

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const membership = pgTable('membership', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'member'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userOrg: uniqueIndex('membership_user_org_idx').on(t.userId, t.orgId),
}));

export const property = pgTable('property', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  address: text('address'),
  reconciliationSkill: text('reconciliation_skill'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const propertyAccess = pgTable('property_access', {
  membershipId: text('membership_id').notNull().references(() => membership.id, { onDelete: 'cascade' }),
  propertyId: text('property_id').notNull().references(() => property.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.membershipId, t.propertyId] }),
}));

export const apiToken = pgTable('api_token', {
  id: text('id').primaryKey(),
  membershipId: text('membership_id').notNull().references(() => membership.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenant = pgTable('tenant', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  accountNumber: text('account_number'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contract = pgTable('contract', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  propertyId: text('property_id').notNull().references(() => property.id, { onDelete: 'restrict' }),
  tenantId: text('tenant_id').notNull().references(() => tenant.id, { onDelete: 'restrict' }),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }),
  securityDeposit: integer('security_deposit_haler'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contractTerms = pgTable('contract_terms', {
  id: text('id').primaryKey(),
  contractId: text('contract_id').notNull().references(() => contract.id, { onDelete: 'cascade' }),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  baseRent: integer('base_rent_haler').notNull(),
  serviceAdvance: integer('service_advance_haler').notNull(),
  paymentDueDay: integer('payment_due_day').notNull().default(10),
  paymentAppliesTo: text('payment_applies_to', { enum: ['current', 'next'] }).notNull().default('current'),
  source: text('source', { enum: ['initial', 'addendum', 'change'] }).notNull(),
  documentRef: text('document_ref'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contractUtility = pgTable('contract_utility', {
  id: text('id').primaryKey(),
  contractId: text('contract_id').notNull().references(() => contract.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['electricity', 'gas', 'internet', 'water', 'other'] }).notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  monthlyAdvance: integer('monthly_advance_haler').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const propertyServiceTariff = pgTable('property_service_tariff', {
  id: text('id').primaryKey(),
  propertyId: text('property_id').notNull().references(() => property.id, { onDelete: 'cascade' }),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  totalSvjAdvance: integer('total_svj_advance_haler').notNull(),
  deductibleAmount: integer('deductible_amount_haler').notNull(),
  deductibleNote: text('deductible_note'),
  documentRef: text('document_ref'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const payment = pgTable('payment', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  contractId: text('contract_id').references(() => contract.id, { onDelete: 'set null' }),
  amount: integer('amount_haler').notNull(),
  paidAt: date('paid_at', { mode: 'string' }).notNull(),
  counterparty: text('counterparty'),
  counterpartyAccount: text('counterparty_account'),
  externalId: text('external_id'),
  statementRef: text('statement_ref'),
  source: text('source', { enum: ['bank', 'manual'] }).notNull(),
  description: text('description'),
  note: text('note'),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgExternal: uniqueIndex('payment_org_external_idx').on(t.orgId, t.externalId),
}));

export const costStatement = pgTable('cost_statement', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  propertyId: text('property_id').notNull().references(() => property.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['services', 'electricity', 'gas', 'internet', 'water', 'other'] }).notNull(),
  periodFrom: date('period_from', { mode: 'string' }).notNull(),
  periodTo: date('period_to', { mode: 'string' }).notNull(),
  totalAmount: integer('total_amount_haler').notNull(),
  adjustmentAmount: integer('adjustment_amount_haler').notNull().default(0),
  adjustmentNote: text('adjustment_note'),
  documentRef: text('document_ref'),
  issuedAt: date('issued_at', { mode: 'string' }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reconciliation = pgTable('reconciliation', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  contractId: text('contract_id').notNull().references(() => contract.id, { onDelete: 'cascade' }),
  periodFrom: date('period_from', { mode: 'string' }).notNull(),
  periodTo: date('period_to', { mode: 'string' }).notNull(),
  status: text('status', { enum: ['draft', 'finalized'] }).notNull().default('draft'),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reconciliationItem = pgTable('reconciliation_item', {
  id: text('id').primaryKey(),
  reconciliationId: text('reconciliation_id').notNull().references(() => reconciliation.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['rent', 'services', 'electricity', 'gas', 'internet', 'water', 'other'] }).notNull(),
  actualCost: integer('actual_cost_haler').notNull(),
  paid: integer('paid_haler').notNull(),
  difference: integer('difference_haler').notNull(),
});

export const rentReduction = pgTable('rent_reduction', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  contractId: text('contract_id').notNull().references(() => contract.id, { onDelete: 'cascade' }),
  forMonth: date('for_month', { mode: 'string' }).notNull(), // always 1st of month, e.g. '2024-11-01'
  amount: integer('amount_haler').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contractMonth: uniqueIndex('rent_reduction_contract_month_idx').on(t.contractId, t.forMonth),
}));
