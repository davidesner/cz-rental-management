import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ----- better-auth tables (names match better-auth defaults) -----

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  accountId: text('account_id').notNull(),
  password: text('password'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: text('access_token_expires_at'),
  refreshTokenExpiresAt: text('refresh_token_expires_at'),
  scope: text('scope'),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  providerUser: uniqueIndex('account_provider_user_idx').on(t.providerId, t.accountId),
}));

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
});

// ----- tenancy tables -----

export const organization = sqliteTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
});

export const membership = sqliteTable('membership', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'member'] }).notNull(),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
}, (t) => ({
  userOrg: uniqueIndex('membership_user_org_idx').on(t.userId, t.orgId),
}));

export const property = sqliteTable('property', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
});

export const propertyAccess = sqliteTable('property_access', {
  membershipId: text('membership_id').notNull().references(() => membership.id, { onDelete: 'cascade' }),
  propertyId: text('property_id').notNull().references(() => property.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.membershipId, t.propertyId] }),
}));

export const apiToken = sqliteTable('api_token', {
  id: text('id').primaryKey(),
  membershipId: text('membership_id').notNull().references(() => membership.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
});
