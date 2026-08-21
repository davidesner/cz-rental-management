import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, primaryKey, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';

// ----- better-auth tables (names match better-auth defaults) -----

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  // Set to true by scripts/create-user.ts for CLI-provisioned users; cleared by
  // the account.update.after hook in core/auth/better-auth.ts when Better Auth's
  // change-password endpoint fires. While true, the auth middleware blocks every
  // route except the change-password flow + /me.
  mustChangePassword: boolean('must_change_password').notNull().default(false),
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

// Better Auth rate-limit storage. Required when `rateLimit.storage: 'database'`
// in core/auth/better-auth.ts (memory storage is per-instance and ineffective on
// serverless function instances).
export const rateLimit = pgTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
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

// ----- bank integration + payment pairing -----

export const bankIntegration = pgTable('bank_integration', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  // Discriminator with exactly one value today. A second bank is a new parser
  // file plus a case — deliberately not a plugin framework.
  kind: text('kind', { enum: ['kb_email'] }).notNull(),
  name: text('name').notNull(),
  imapHost: text('imap_host').notNull(),
  imapPort: integer('imap_port').notNull().default(993),
  imapUser: text('imap_user').notNull(),
  // AES-256-GCM ciphertext from core/lib/crypto-box.ts. NEVER returned by the API.
  imapPasswordEnc: text('imap_password_enc').notNull(),
  imapFolder: text('imap_folder').notNull().default('INBOX'),
  fromFilter: text('from_filter').notNull().default('servis@kbinfo.cz'),
  subjectFilter: text('subject_filter').notNull().default('Přijali jsme platbu'),
  // Which of the user's OWN accounts this mailbox reports on. When set,
  // notifications addressed elsewhere are ignored rather than imported.
  accountNumber: text('account_number'),
  active: boolean('active').notNull().default(true),
  // IMAP incremental cursor. UIDs are only meaningful within one uidValidity
  // generation; when the server reports a different one, the cursor is rebuilt
  // from a date-based search.
  uidValidity: bigint('uid_validity', { mode: 'number' }),
  lastUid: bigint('last_uid', { mode: 'number' }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSyncStatus: text('last_sync_status', { enum: ['ok', 'error'] }),
  lastSyncError: text('last_sync_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bankTransaction = pgTable('bank_transaction', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  integrationId: text('integration_id').notNull().references(() => bankIntegration.id, { onDelete: 'cascade' }),
  // The e-mail's Message-ID. KB gives us no transaction id, so this is the
  // idempotency key for "have we already imported this notification".
  messageId: text('message_id').notNull(),
  amount: integer('amount_haler').notNull(),
  currency: text('currency').notNull(),
  valueDate: date('value_date', { mode: 'string' }).notNull(),
  fromAccount: text('from_account'),
  toAccount: text('to_account'),
  vs: text('vs'),
  ks: text('ks'),
  ss: text('ss'),
  messageForRecipient: text('message_for_recipient'),
  // The "Zobrazit online" href. Stored for reference and NEVER fetched by us:
  // it is a click-tracker, so following it registers a click and it may be
  // single-use.
  sourceLink: text('source_link'),
  // The ordered <span> token array (~1 KB), enough to re-parse after a parser
  // fix without keeping 90 KB of HTML per message.
  rawTokens: jsonb('raw_tokens').$type<string[]>(),
  status: text('status', {
    enum: ['unmatched', 'matched', 'ambiguous', 'suspected_duplicate', 'ignored', 'parse_failed'],
  }).notNull(),
  statusReason: text('status_reason'),
  duplicateOfTransactionId: text('duplicate_of_transaction_id')
    .references((): AnyPgColumn => bankTransaction.id, { onDelete: 'set null' }),
  matchedBy: text('matched_by', { enum: ['rule', 'manual'] }),
  // ON DELETE SET NULL, not cascade: `paymentId IS NULL` is the source of truth
  // for "needs attention", so deleting a payment must return the transaction to
  // the inbox rather than delete the audit record with it.
  paymentId: text('payment_id').references(() => payment.id, { onDelete: 'set null' }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgMessage: uniqueIndex('bank_transaction_org_message_idx').on(t.orgId, t.messageId),
  // Both FKs above are ON DELETE SET NULL, and Postgres does not index the
  // referencing side for you: without these, every DELETE FROM payment (and
  // every delete of a bank_transaction) sequentially scans this whole table to
  // find the rows it has to null out.
  paymentRef: index('bank_transaction_payment_idx').on(t.paymentId),
  duplicateRef: index('bank_transaction_duplicate_of_idx').on(t.duplicateOfTransactionId),
}));

export const paymentMatchingRule = pgTable('payment_matching_rule', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  contractId: text('contract_id').notNull().references(() => contract.id, { onDelete: 'cascade' }),
  // null on any criterion means "cokoliv". A rule with every criterion null is
  // rejected in core/lib/payment-pairing.ts#validateRuleCriteria, not here.
  counterpartyAccount: text('counterparty_account'),
  vs: text('vs'),
  ks: text('ks'),
  ss: text('ss'),
  amountFrom: integer('amount_from_haler'),
  amountTo: integer('amount_to_haler'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contractUnique: uniqueIndex('payment_matching_rule_contract_idx').on(t.contractId),
}));

// A short run log so a cron you cannot watch stays debuggable.
//
// Deliberately has NO orgId column, unlike the other bank_* tables: it is
// org-scoped only TRANSITIVELY, via integrationId -> bank_integration.orgId.
// That is safe because integrationId is NOT NULL and cascades, so org deletion
// still reaps runs, and because nothing reads this table through the API — the
// sync writes it and a human reads it directly. If a run-history endpoint is
// ever added, it MUST join through bank_integration to scope by org; there is
// no orgId here to filter on.
export const bankSyncRun = pgTable('bank_sync_run', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id').notNull().references(() => bankIntegration.id, { onDelete: 'cascade' }),
  trigger: text('trigger', { enum: ['cron', 'manual'] }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status', { enum: ['ok', 'error'] }).notNull(),
  fetched: integer('fetched').notNull().default(0),
  created: integer('created').notNull().default(0),
  matched: integer('matched').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  // The last failure seen in the run, as `${reason}: ${detail}` — the parser's
  // reason code plus its own explanation, or `db_error (uid …, <Message-ID>)`
  // for a message whose staging insert threw. NOT the raw HTML: the diagnostic
  // snapshot is bank_transaction.rawTokens, which is what reparse reads.
  error: text('error'),
});
