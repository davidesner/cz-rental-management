# Plan 1 — Skeleton + Auth + Multi-tenancy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stojící Hono backend s libSQL/Drizzle, better-auth (email+heslo), multi-tenant scoping (Organization/Membership/PropertyAccess) a Bearer API tokenem pro MCP. Konec: lze se zaregistrovat, vytvořit organizaci, vydat API token, zavolat autentizovaný `/api/me`.

**Architecture:** Single-process Hono server běží lokálně přes `tsx`, později má adaptér pro Vercel. Auth obsluhuje better-auth (cookies pro budoucí UI + Bearer tokeny pro MCP). Drizzle ORM nad libSQL — soubor lokálně, Turso v produkci. Service vrstva v `core/services/*` je framework-agnostic, REST routy jsou tenké wrappers nad ní.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, libSQL (`@libsql/client`), better-auth, Zod, Vitest, tsx, pnpm.

**Where this fits in the 7-plan roadmap (spec §12):**
- Plan 1 (this) — Skeleton + Auth + Multi-tenancy
- Plan 2 — Core domain (Property+`reconciliationSkill`, Tenant, Contract) + Temporal (ContractTerms, ContractUtility, PropertyServiceTariff)
- Plan 3 — Payments + CostStatement (idempotent import, `adjustmentAmount`)
- Plan 4 — Reconciliation service + REST + **E2E <property-name-a> 2024 / <tenant-name>** reference test (must produce +693 Kč diff matching the manual sheet)
- Plan 5 — fastmcp stdio server + skill template + <property-name-a> MCP replay (same scenario via tools)
- Plan 6 — UI (React+shadcn) + Chrome MCP smoke tests
- Plan 7 — Comprehensive unit test coverage via parallel agent team

Deploy (Docker/Vercel) **explicitly out of scope** for now — everything runs locally via `pnpm dev` + libSQL file.

---

## File Structure

```
package.json
tsconfig.json
.gitignore
.env.example
drizzle.config.ts
core/
  db/
    schema.ts              -- Drizzle table definitions
    client.ts              -- libSQL client + drizzle instance factory
    migrate.ts             -- Migration runner script
  auth/
    better-auth.ts         -- better-auth instance + config
    context.ts             -- AuthContext type + helpers
    token.ts               -- API token hash/verify utilities
  services/
    organization.ts        -- create/list/get organization + membership
    membership.ts          -- role/access checks
    property-access.ts     -- grant/revoke property access
    api-token.ts           -- issue/revoke/verify API tokens
  errors.ts                -- AppError, kinds, HTTP mapping
  zod-schemas.ts           -- shared zod input schemas
server/
  app.ts                   -- Hono app factory (used by node + tests)
  routes/
    auth.ts                -- /api/auth/* (better-auth handler)
    me.ts                  -- GET /api/me
    organizations.ts       -- /api/organizations
    api-tokens.ts          -- /api/api-tokens
    property-access.ts     -- /api/property-access
  middleware/
    auth.ts                -- session OR bearer → AuthContext
    errors.ts              -- AppError → JSON
  node.ts                  -- Node entrypoint (@hono/node-server)
tests/
  helpers/
    db.ts                  -- in-memory libSQL + run migrations
    app.ts                 -- build app for tests
    fixtures.ts            -- register user, create org, issue token
  auth.test.ts
  organizations.test.ts
  api-tokens.test.ts
  property-access.test.ts
  me.test.ts
drizzle/                   -- generated migrations land here
data/                      -- runtime DB file (gitignored)
```

---

## Conventions

- **TDD:** Each task = failing test → minimal impl → passing test → commit. Commits referenced by feat/refactor/chore prefix.
- **Tests:** Vitest, in-memory libSQL (`":memory:"`), fresh DB per test file (via `beforeEach`).
- **Errors:** All service errors are `AppError` with a `kind` (e.g. `"not_found"`, `"forbidden"`, `"conflict"`, `"unauthenticated"`). Middleware maps to HTTP.
- **Money/IDs:** All money in integer minor units (haléře = 1/100 Kč). All IDs are `cuid2` strings (`@paralleldrive/cuid2`).
- **Time:** Datetimes stored as ISO 8601 strings in libSQL (`text` mode). Dates as `YYYY-MM-DD` strings.
- **Names:** Schema in `snake_case`, TypeScript in `camelCase`, Drizzle handles mapping.
- **No code comments** unless something is non-obvious. Tests document behavior.

---

### Task 1: Repo bootstrap

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `README.md`

- [ ] **Step 1: Initialize repo and ignore files**

Run:
```bash
cd /Users/esner/Projects/rental_management
git init
```

Write `.gitignore`:
```
node_modules/
dist/
data/
.env
.env.local
*.log
.DS_Store
coverage/
.vscode/
```

Write `.env.example`:
```
DATABASE_URL=file:./data/rental.sqlite
BETTER_AUTH_SECRET=replace-me-with-openssl-rand-base64-32
BETTER_AUTH_URL=http://localhost:3000
PORT=3000
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "rental-management",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch server/node.ts",
    "build": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx core/db/migrate.ts",
    "db:studio": "drizzle-kit studio"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022"],
    "baseUrl": ".",
    "paths": {
      "@core/*": ["core/*"],
      "@server/*": ["server/*"]
    }
  },
  "include": ["core/**/*", "server/**/*", "tests/**/*", "drizzle.config.ts"]
}
```

- [ ] **Step 4: Install runtime + dev dependencies**

```bash
pnpm init -y
pnpm add hono @hono/node-server @libsql/client drizzle-orm \
         better-auth zod @paralleldrive/cuid2
pnpm add -D typescript tsx vitest @types/node drizzle-kit dotenv
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: bootstrap project skeleton"
```

---

### Task 2: Drizzle config + DB client + migration runner

**Files:**
- Create: `drizzle.config.ts`, `core/db/client.ts`, `core/db/migrate.ts`

- [ ] **Step 1: Write `drizzle.config.ts`**

```ts
import 'dotenv/config';
import type { Config } from 'drizzle-kit';

export default {
  schema: './core/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  // Note: drizzle-kit no longer accepts driver: 'libsql' for the sqlite dialect
  // (valid values are 'd1-http' | 'expo' | 'durable-sqlite'). For libSQL/Turso,
  // dialect alone suffices — driver is inferred from the URL scheme.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./data/rental.sqlite',
  },
} satisfies Config;
```

- [ ] **Step 2: Write `core/db/client.ts`**

```ts
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema.js';

export type DB = LibSQLDatabase<typeof schema>;

export function createDb(url: string): { db: DB; client: Client } {
  const client = createClient({ url });
  const db = drizzle(client, { schema });
  return { db, client };
}

export function createMemoryDb(): { db: DB; client: Client } {
  return createDb(':memory:');
}
```

- [ ] **Step 3: Write `core/db/migrate.ts`**

```ts
import 'dotenv/config';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDb } from './client.js';

const url = process.env.DATABASE_URL ?? 'file:./data/rental.sqlite';
const { db, client } = createDb(url);

await migrate(db, { migrationsFolder: './drizzle' });
console.log('migrations applied to', url);
client.close();
```

- [ ] **Step 4: Verify the migrate script compiles**

Run: `pnpm build`
Expected: exits with code 0 (schema.ts not yet present is allowed — Drizzle types still compile because schema.ts will exist next task; if it errors with "Cannot find module './schema.js'", create an empty `core/db/schema.ts` exporting `export {};`).

- [ ] **Step 5: Commit**

```bash
git add drizzle.config.ts core/db/client.ts core/db/migrate.ts core/db/schema.ts
git commit -m "feat: add drizzle libSQL client and migration runner"
```

---

### Task 3: Schema — User, Credential, Session (better-auth tables)

**Files:**
- Modify: `core/db/schema.ts`
- Test: `tests/schema-bootstrap.test.ts`

better-auth expects specific table names (`user`, `account`, `session`, `verification`). We define them ourselves so Drizzle owns the schema source of truth. The `account` table is better-auth's name for what our spec calls Credential.

- [ ] **Step 1: Write the failing test**

`tests/schema-bootstrap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMemoryDb } from '../core/db/client.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { sql } from 'drizzle-orm';

describe('schema bootstrap', () => {
  it('creates user/account/session tables', async () => {
    const { db, client } = createMemoryDb();
    await migrate(db, { migrationsFolder: './drizzle' });
    const rows = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    );
    const names = rows.map((r) => r.name);
    expect(names).toContain('user');
    expect(names).toContain('account');
    expect(names).toContain('session');
    expect(names).toContain('verification');
    client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/schema-bootstrap.test.ts`
Expected: FAIL (no migrations directory / no user table).

- [ ] **Step 3: Write the schema**

`core/db/schema.ts`:

```ts
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
  providerId: text('provider_id').notNull(),         // "credential" for email+pw, "google" for SSO, ...
  accountId: text('account_id').notNull(),           // provider-specific user id (for email+pw == userId)
  password: text('password'),                        // argon2 hash (only for credential provider)
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
```

- [ ] **Step 4: Generate + apply migration**

Run:
```bash
pnpm db:generate
pnpm test tests/schema-bootstrap.test.ts
```

Expected: PASS. (A migration file appears under `drizzle/`.)

- [ ] **Step 5: Commit**

```bash
git add core/db/schema.ts drizzle/ tests/schema-bootstrap.test.ts
git commit -m "feat: add better-auth tables (user, account, session, verification)"
```

---

### Task 4: Schema — Organization, Membership, PropertyAccess, ApiToken

**Files:**
- Modify: `core/db/schema.ts`
- Test: `tests/schema-tenancy.test.ts`

Note: `PropertyAccess` references `property` which doesn't exist yet — we add the table now (just `id`, `org_id`, `name`) so foreign keys hold. Property's full shape arrives in Plan 2.

- [ ] **Step 1: Write the failing test**

`tests/schema-tenancy.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMemoryDb } from '../core/db/client.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { sql } from 'drizzle-orm';

describe('tenancy schema', () => {
  it('creates organization/membership/property/property_access/api_token tables', async () => {
    const { db, client } = createMemoryDb();
    await migrate(db, { migrationsFolder: './drizzle' });
    const rows = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    );
    const names = rows.map((r) => r.name);
    for (const t of ['organization', 'membership', 'property', 'property_access', 'api_token']) {
      expect(names).toContain(t);
    }
    client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/schema-tenancy.test.ts`
Expected: FAIL (tables not present).

- [ ] **Step 3: Extend `core/db/schema.ts`**

Append:

```ts
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

// Minimal stub - full Property schema arrives in Plan 2.
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
```

- [ ] **Step 4: Generate + apply migration; rerun test**

Run:
```bash
pnpm db:generate
pnpm test tests/schema-tenancy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/db/schema.ts drizzle/ tests/schema-tenancy.test.ts
git commit -m "feat: add tenancy schema (org, membership, property stub, api token)"
```

---

### Task 5: AppError + error middleware

**Files:**
- Create: `core/errors.ts`, `server/middleware/errors.ts`
- Test: `tests/errors.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AppError } from '../core/errors.js';
import { Hono } from 'hono';
import { errorMiddleware } from '../server/middleware/errors.js';

describe('error middleware', () => {
  const app = new Hono();
  app.onError(errorMiddleware);
  app.get('/not-found', () => { throw new AppError('not_found', 'no'); });
  app.get('/forbidden', () => { throw new AppError('forbidden', 'no'); });
  app.get('/conflict', () => { throw new AppError('conflict', 'no'); });
  app.get('/validation', () => { throw new AppError('validation', 'no', { field: 'x' }); });
  app.get('/unauth', () => { throw new AppError('unauthenticated', 'no'); });
  app.get('/boom', () => { throw new Error('boom'); });

  it.each([
    ['/not-found', 404],
    ['/forbidden', 403],
    ['/conflict', 409],
    ['/validation', 422],
    ['/unauth', 401],
    ['/boom', 500],
  ])('maps %s to %i', async (path, status) => {
    const res = await app.request(path);
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/errors.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `core/errors.ts`**

```ts
export type AppErrorKind =
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'validation'
  | 'unauthenticated'
  | 'bad_request';

export class AppError extends Error {
  constructor(
    public readonly kind: AppErrorKind,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

- [ ] **Step 4: Implement `server/middleware/errors.ts`**

```ts
import type { Context } from 'hono';
import { AppError } from '../../core/errors.js';

const statusByKind: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  validation: 422,
  unauthenticated: 401,
  bad_request: 400,
};

export function errorMiddleware(err: Error, c: Context) {
  if (err instanceof AppError) {
    const status = statusByKind[err.kind] ?? 500;
    return c.json({ error: { kind: err.kind, message: err.message, details: err.details } }, status as never);
  }
  console.error(err);
  return c.json({ error: { kind: 'internal', message: 'internal error' } }, 500);
}
```

- [ ] **Step 5: Run test, commit**

Run: `pnpm test tests/errors.test.ts`
Expected: PASS.

```bash
git add core/errors.ts server/middleware/errors.ts tests/errors.test.ts
git commit -m "feat: AppError + HTTP error middleware"
```

---

### Task 6: better-auth instance

**Files:**
- Create: `core/auth/better-auth.ts`

- [ ] **Step 1: Implement better-auth config**

```ts
import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema.js';

export function createAuth(db: DB) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: {
        user: schema.user,
        account: schema.account,
        session: schema.session,
        verification: schema.verification,
      },
    }),
    secret: process.env.BETTER_AUTH_SECRET ?? 'dev-secret-do-not-use',
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    advanced: { generateId: false }, // we accept better-auth defaults
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

- [ ] **Step 2: Compile check**

Run: `pnpm build`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add core/auth/better-auth.ts
git commit -m "feat: configure better-auth with drizzle adapter"
```

---

### Task 7: Token hash utilities

**Files:**
- Create: `core/auth/token.ts`
- Test: `tests/token.test.ts`

API tokens use SHA-256 over a random secret (raw bytes hex). DB stores hex digest. Comparison is hex equality. Argon2 would be overkill — tokens are full-entropy random strings, not user-chosen passwords.

- [ ] **Step 1: Write the failing test**

`tests/token.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateToken, hashToken } from '../core/auth/token.js';

describe('api token', () => {
  it('generates a token and matches its hash', () => {
    const t = generateToken();
    expect(t).toMatch(/^rmt_[a-f0-9]{64}$/);
    const h = hashToken(t);
    expect(h).toHaveLength(64);
    expect(hashToken(t)).toBe(h);
  });

  it('different tokens produce different hashes', () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/token.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`core/auth/token.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

const PREFIX = 'rmt_'; // rental-management-token

export function generateToken(): string {
  return PREFIX + randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

- [ ] **Step 4: Run test, commit**

Run: `pnpm test tests/token.test.ts`
Expected: PASS.

```bash
git add core/auth/token.ts tests/token.test.ts
git commit -m "feat: api token generation and hashing"
```

---

### Task 8: AuthContext type and helpers

**Files:**
- Create: `core/auth/context.ts`
- Test: `tests/auth-context.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/auth-context.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canSeeProperty, requirePropertyAccess } from '../core/auth/context.js';
import { AppError } from '../core/errors.js';

const ownerCtx = {
  userId: 'u1',
  orgId: 'o1',
  membershipId: 'm1',
  role: 'owner' as const,
  allowedPropertyIds: null,
};
const memberCtx = {
  userId: 'u2',
  orgId: 'o1',
  membershipId: 'm2',
  role: 'member' as const,
  allowedPropertyIds: ['p1', 'p2'],
};

describe('canSeeProperty', () => {
  it('owner sees everything', () => {
    expect(canSeeProperty(ownerCtx, 'pX')).toBe(true);
  });
  it('member sees only allowed', () => {
    expect(canSeeProperty(memberCtx, 'p1')).toBe(true);
    expect(canSeeProperty(memberCtx, 'pX')).toBe(false);
  });
});

describe('requirePropertyAccess', () => {
  it('throws forbidden when not allowed', () => {
    expect(() => requirePropertyAccess(memberCtx, 'pX')).toThrowError(AppError);
  });
  it('passes for owner', () => {
    expect(() => requirePropertyAccess(ownerCtx, 'pX')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/auth-context.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `core/auth/context.ts`**

```ts
import { AppError } from '../errors.js';

export type Role = 'owner' | 'member';

export interface AuthContext {
  userId: string;
  orgId: string;
  membershipId: string;
  role: Role;
  /** null = owner, sees all properties in org. Array = explicit per-property scope. */
  allowedPropertyIds: string[] | null;
}

export function canSeeProperty(ctx: AuthContext, propertyId: string): boolean {
  if (ctx.role === 'owner') return true;
  return ctx.allowedPropertyIds?.includes(propertyId) ?? false;
}

export function requirePropertyAccess(ctx: AuthContext, propertyId: string): void {
  if (!canSeeProperty(ctx, propertyId)) {
    throw new AppError('forbidden', `no access to property ${propertyId}`);
  }
}
```

- [ ] **Step 4: Run test, commit**

Run: `pnpm test tests/auth-context.test.ts`
Expected: PASS.

```bash
git add core/auth/context.ts tests/auth-context.test.ts
git commit -m "feat: AuthContext with property-scope helpers"
```

---

### Task 9: Test helpers (db + app)

**Files:**
- Create: `tests/helpers/db.ts`, `tests/helpers/app.ts`, `tests/helpers/fixtures.ts`

These helpers are used by all subsequent route tests. Build them once.

- [ ] **Step 1: Write `tests/helpers/db.ts`**

```ts
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../core/db/schema.js';

export type DB = LibSQLDatabase<typeof schema>;

export async function freshDb(): Promise<{ db: DB; client: Client }> {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: './drizzle' });
  return { db, client };
}
```

- [ ] **Step 2: Write `tests/helpers/app.ts`** (stub — to be filled by Task 14)

```ts
import type { DB } from './db.js';
import { buildApp } from '../../server/app.js';

export function makeApp(db: DB) {
  return buildApp({ db });
}
```

- [ ] **Step 3: Write `tests/helpers/fixtures.ts`** (will gain helpers as tasks proceed)

```ts
import type { Hono } from 'hono';

export async function registerUser(app: Hono, email: string, password: string, name: string) {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie') ?? '';
  const body = await res.json();
  return { userId: body.user.id, cookie };
}
```

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/
git commit -m "test: shared helpers for in-memory db and app construction"
```

---

### Task 10: Hono app factory + auth route mount

**Files:**
- Create: `server/app.ts`, `server/routes/auth.ts`
- Test: `tests/auth.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

describe('email + password sign up / sign in', () => {
  it('registers and signs in a user', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { userId, cookie } = await registerUser(app, 'a@b.cz', 'password123', 'Alice');
    expect(userId).toBeTruthy();
    expect(cookie).toContain('better-auth');

    const signIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.cz', password: 'password123' }),
    });
    expect(signIn.status).toBe(200);
    client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/auth.test.ts`
Expected: FAIL (`server/app.ts` missing).

- [ ] **Step 3: Write `server/routes/auth.ts`**

```ts
import { Hono } from 'hono';
import type { Auth } from '../../core/auth/better-auth.js';

export function authRoutes(auth: Auth) {
  const r = new Hono();
  r.on(['POST', 'GET'], '/auth/*', (c) => auth.handler(c.req.raw));
  return r;
}
```

- [ ] **Step 4: Write `server/app.ts`**

```ts
import { Hono } from 'hono';
import { createAuth } from '../core/auth/better-auth.js';
import { errorMiddleware } from './middleware/errors.js';
import { authRoutes } from './routes/auth.js';
import type { DB } from '../core/db/client.js';

export interface AppDeps {
  db: DB;
}

export function buildApp(deps: AppDeps) {
  const app = new Hono();
  const auth = createAuth(deps.db);

  app.onError(errorMiddleware);
  app.route('/api', authRoutes(auth));

  // expose for later middleware
  app.use('*', async (c, next) => {
    c.set('auth', auth);
    c.set('db', deps.db);
    await next();
  });

  return app;
}
```

- [ ] **Step 5: Run test, commit**

Run: `pnpm test tests/auth.test.ts`
Expected: PASS.

```bash
git add server/app.ts server/routes/auth.ts tests/auth.test.ts
git commit -m "feat: Hono app factory mounting better-auth handler"
```

---

### Task 11: Organization service — create + list

**Files:**
- Create: `core/services/organization.ts`
- Test: `tests/organizations-service.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/organizations-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { createOrganization, listOrganizationsForUser } from '../core/services/organization.js';
import { user } from '../core/db/schema.js';

async function makeUser(db: any, id = 'u_1') {
  await db.insert(user).values({ id, name: 'A', email: `${id}@x.cz`, emailVerified: false });
  return id;
}

describe('organization service', () => {
  it('creates an org and an owner membership', async () => {
    const { db, client } = await freshDb();
    const uid = await makeUser(db);
    const org = await createOrganization(db, { userId: uid, name: 'Acme' });
    expect(org.id).toBeTruthy();
    expect(org.role).toBe('owner');
    const list = await listOrganizationsForUser(db, uid);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Acme');
    client.close();
  });

  it('lists multiple orgs for same user', async () => {
    const { db, client } = await freshDb();
    const uid = await makeUser(db);
    await createOrganization(db, { userId: uid, name: 'A' });
    await createOrganization(db, { userId: uid, name: 'B' });
    const list = await listOrganizationsForUser(db, uid);
    expect(list.map((o) => o.name).sort()).toEqual(['A', 'B']);
    client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/organizations-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement service**

`core/services/organization.ts`:

```ts
import { createId } from '@paralleldrive/cuid2';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { organization, membership } from '../db/schema.js';

export interface CreateOrgInput {
  userId: string;
  name: string;
}

export interface OrgWithRole {
  id: string;
  name: string;
  role: 'owner' | 'member';
  membershipId: string;
}

export async function createOrganization(db: DB, input: CreateOrgInput): Promise<OrgWithRole> {
  const orgId = createId();
  const membershipId = createId();
  await db.transaction(async (tx) => {
    await tx.insert(organization).values({ id: orgId, name: input.name });
    await tx.insert(membership).values({
      id: membershipId,
      userId: input.userId,
      orgId,
      role: 'owner',
    });
  });
  return { id: orgId, name: input.name, role: 'owner', membershipId };
}

export async function listOrganizationsForUser(db: DB, userId: string): Promise<OrgWithRole[]> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      role: membership.role,
      membershipId: membership.id,
    })
    .from(organization)
    .innerJoin(membership, eq(membership.orgId, organization.id))
    .where(eq(membership.userId, userId));
  return rows;
}
```

- [ ] **Step 4: Run test, commit**

Run: `pnpm test tests/organizations-service.test.ts`
Expected: PASS.

```bash
git add core/services/organization.ts tests/organizations-service.test.ts
git commit -m "feat: organization service with auto-owner membership"
```

---

### Task 12: Auth middleware — session OR bearer → AuthContext

**Files:**
- Create: `server/middleware/auth.ts`
- Modify: `server/app.ts` (mount middleware)
- Test: `tests/auth-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/auth-middleware.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';
import { createOrganization } from '../core/services/organization.js';
import { generateToken, hashToken } from '../core/auth/token.js';
import { apiToken } from '../core/db/schema.js';

describe('auth middleware', () => {
  it('rejects unauthenticated request', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const res = await app.request('/api/me');
    expect(res.status).toBe(401);
    client.close();
  });

  it('accepts session cookie', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { userId, cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    await createOrganization(db, { userId, name: 'O' });
    const res = await app.request('/api/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    client.close();
  });

  it('accepts bearer token', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { userId } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    const org = await createOrganization(db, { userId, name: 'O' });
    const t = generateToken();
    await db.insert(apiToken).values({
      id: 'at1', membershipId: org.membershipId, name: 't', tokenHash: hashToken(t),
    });
    const res = await app.request('/api/me', { headers: { authorization: `Bearer ${t}` } });
    expect(res.status).toBe(200);
    client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/auth-middleware.test.ts`
Expected: FAIL (`/api/me` not yet routed).

- [ ] **Step 3: Implement middleware**

`server/middleware/auth.ts`:

```ts
import type { Context, Next } from 'hono';
import { eq } from 'drizzle-orm';
import type { DB } from '../../core/db/client.js';
import type { Auth } from '../../core/auth/better-auth.js';
import { AppError } from '../../core/errors.js';
import type { AuthContext } from '../../core/auth/context.js';
import { apiToken, membership, propertyAccess } from '../../core/db/schema.js';
import { hashToken } from '../../core/auth/token.js';

async function loadMembershipForUser(db: DB, userId: string, orgIdHint?: string) {
  const rows = await db.select().from(membership).where(eq(membership.userId, userId));
  if (rows.length === 0) throw new AppError('forbidden', 'user has no organization');
  const chosen = orgIdHint ? rows.find((r) => r.orgId === orgIdHint) : rows[0];
  if (!chosen) throw new AppError('forbidden', 'no membership for requested org');
  return chosen;
}

async function loadAllowedProperties(db: DB, membershipId: string, role: string): Promise<string[] | null> {
  if (role === 'owner') return null;
  const rows = await db.select().from(propertyAccess).where(eq(propertyAccess.membershipId, membershipId));
  return rows.map((r) => r.propertyId);
}

export function authMiddleware() {
  return async (c: Context, next: Next) => {
    const db = c.get('db') as DB;
    const auth = c.get('auth') as Auth;

    // 1) Try Bearer
    const authz = c.req.header('authorization');
    if (authz?.startsWith('Bearer ')) {
      const token = authz.slice('Bearer '.length).trim();
      const row = await db.select().from(apiToken).where(eq(apiToken.tokenHash, hashToken(token))).get();
      if (!row) throw new AppError('unauthenticated', 'invalid token');
      const m = await db.select().from(membership).where(eq(membership.id, row.membershipId)).get();
      if (!m) throw new AppError('unauthenticated', 'membership missing for token');
      const allowed = await loadAllowedProperties(db, m.id, m.role);
      const ctx: AuthContext = {
        userId: m.userId, orgId: m.orgId, membershipId: m.id, role: m.role, allowedPropertyIds: allowed,
      };
      c.set('auth_ctx', ctx);
      return next();
    }

    // 2) Try better-auth session via headers
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new AppError('unauthenticated', 'no session');
    const orgHint = c.req.header('x-org-id') ?? undefined;
    const m = await loadMembershipForUser(db, session.user.id, orgHint);
    const allowed = await loadAllowedProperties(db, m.id, m.role);
    const ctx: AuthContext = {
      userId: m.userId, orgId: m.orgId, membershipId: m.id, role: m.role, allowedPropertyIds: allowed,
    };
    c.set('auth_ctx', ctx);
    return next();
  };
}

export function getCtx(c: Context): AuthContext {
  const ctx = c.get('auth_ctx') as AuthContext | undefined;
  if (!ctx) throw new AppError('unauthenticated', 'no auth context');
  return ctx;
}
```

- [ ] **Step 4: Wire middleware into `server/app.ts`** (modify)

Replace the prior `app.use('*'…)` block with:

```ts
app.use('*', async (c, next) => {
  c.set('auth', auth);
  c.set('db', deps.db);
  await next();
});

// /api/auth/* is already mounted before — leave unauthenticated.
// Everything else under /api requires auth:
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next();
  return authMiddleware()(c, next);
});
```

Add import: `import { authMiddleware } from './middleware/auth.js';`

- [ ] **Step 5: Add a stub `/api/me` route so the test can hit it**

`server/routes/me.ts`:

```ts
import { Hono } from 'hono';
import { getCtx } from '../middleware/auth.js';

export function meRoutes() {
  const r = new Hono();
  r.get('/me', (c) => {
    const ctx = getCtx(c);
    return c.json({ ctx });
  });
  return r;
}
```

Mount in `server/app.ts`:
```ts
app.route('/api', meRoutes());
```

- [ ] **Step 6: Run test, commit**

Run: `pnpm test tests/auth-middleware.test.ts`
Expected: PASS.

```bash
git add server/middleware/auth.ts server/app.ts server/routes/me.ts tests/auth-middleware.test.ts
git commit -m "feat: auth middleware (session + bearer) and /api/me"
```

---

### Task 13: Organizations REST routes

**Files:**
- Create: `server/routes/organizations.ts`
- Modify: `server/app.ts` (mount)
- Test: `tests/organizations.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/organizations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

describe('POST /api/organizations', () => {
  it('creates an org and returns owner membership', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    const res = await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Acme' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.organization.name).toBe('Acme');
    expect(body.organization.role).toBe('owner');
    client.close();
  });
});

describe('GET /api/organizations', () => {
  it('lists user organizations', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'A' }),
    });
    await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'B' }),
    });
    const res = await app.request('/api/organizations', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organizations).toHaveLength(2);
    client.close();
  });
});
```

**Note on initial-org bootstrap:** First org create happens *before* the user has any membership. So `/api/organizations` POST is exempt from `loadMembershipForUser` requirement. Implement by branching in the route before middleware enforces membership.

Actually cleanest: make `loadMembershipForUser` lazy — middleware lets a user with no memberships through, only their userId is set. The route layer decides what to do.

- [ ] **Step 2: Adjust middleware to allow zero-membership users**

In `server/middleware/auth.ts`, change `loadMembershipForUser`:

```ts
async function loadMembershipForUser(db: DB, userId: string, orgIdHint?: string) {
  const rows = await db.select().from(membership).where(eq(membership.userId, userId));
  if (rows.length === 0) return null;
  const chosen = orgIdHint ? rows.find((r) => r.orgId === orgIdHint) : rows[0];
  return chosen ?? null;
}
```

In the session branch, allow no-membership context:

```ts
const m = await loadMembershipForUser(db, session.user.id, orgHint);
if (!m) {
  c.set('auth_ctx', { userId: session.user.id, orgId: null, membershipId: null, role: null, allowedPropertyIds: null });
  return next();
}
```

Update `AuthContext` type to allow nulls in `core/auth/context.ts`:

```ts
export interface AuthContext {
  userId: string;
  orgId: string | null;
  membershipId: string | null;
  role: Role | null;
  allowedPropertyIds: string[] | null;
}
```

And update prior tests that exercised the strict-form ctx — none yet beyond auth-context unit test which used full ctx, still valid.

In `getCtx`, return as-is.

Add helper `requireOrg(ctx): asserts ctx as OrgScopedAuthContext`:

```ts
export type OrgScopedAuthContext = AuthContext & { orgId: string; membershipId: string; role: Role };

export function requireOrg(ctx: AuthContext): asserts ctx is OrgScopedAuthContext {
  if (!ctx.orgId || !ctx.membershipId || !ctx.role) {
    throw new AppError('forbidden', 'no organization in context');
  }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/organizations.test.ts`
Expected: FAIL (route not mounted).

- [ ] **Step 4: Implement route**

`server/routes/organizations.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { createOrganization, listOrganizationsForUser } from '../../core/services/organization.js';
import type { DB } from '../../core/db/client.js';

const CreateOrg = z.object({ name: z.string().min(1).max(200) });

export function organizationRoutes() {
  const r = new Hono();

  r.post('/organizations', async (c) => {
    const ctx = getCtx(c);
    const body = CreateOrg.parse(await c.req.json());
    const db = c.get('db') as DB;
    const org = await createOrganization(db, { userId: ctx.userId, name: body.name });
    return c.json({ organization: org }, 201);
  });

  r.get('/organizations', async (c) => {
    const ctx = getCtx(c);
    const db = c.get('db') as DB;
    const orgs = await listOrganizationsForUser(db, ctx.userId);
    return c.json({ organizations: orgs });
  });

  return r;
}
```

Mount in `server/app.ts`:
```ts
app.route('/api', organizationRoutes());
```

- [ ] **Step 5: Run test, commit**

Run: `pnpm test tests/organizations.test.ts`
Expected: PASS.

```bash
git add server/routes/organizations.ts server/app.ts server/middleware/auth.ts core/auth/context.ts tests/organizations.test.ts
git commit -m "feat: organization CRUD routes; relaxed auth ctx for pre-org users"
```

---

### Task 14: Property-stub create endpoint (needed for property-access tests)

**Files:**
- Create: `core/services/property.ts` (stub), `server/routes/properties.ts` (stub)
- Modify: `server/app.ts`
- Test: covered in Plan 2; for now a minimal create.

We need ability to create a property to test `PropertyAccess`. Full Property service comes in Plan 2.

- [ ] **Step 1: Write minimal service**

`core/services/property.ts`:

```ts
import { createId } from '@paralleldrive/cuid2';
import type { DB } from '../db/client.js';
import { property } from '../db/schema.js';

export async function createPropertyStub(db: DB, orgId: string, name: string) {
  const id = createId();
  await db.insert(property).values({ id, orgId, name });
  return { id, orgId, name };
}
```

- [ ] **Step 2: Write minimal route**

`server/routes/properties.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { createPropertyStub } from '../../core/services/property.js';
import type { DB } from '../../core/db/client.js';

const CreateProperty = z.object({ name: z.string().min(1).max(200) });

export function propertyRoutes() {
  const r = new Hono();
  r.post('/properties', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const body = CreateProperty.parse(await c.req.json());
    const db = c.get('db') as DB;
    const p = await createPropertyStub(db, ctx.orgId, body.name);
    return c.json({ property: p }, 201);
  });
  return r;
}
```

Mount in app: `app.route('/api', propertyRoutes());`

- [ ] **Step 3: Commit**

```bash
git add core/services/property.ts server/routes/properties.ts server/app.ts
git commit -m "feat: property stub create (full impl in Plan 2)"
```

---

### Task 15: PropertyAccess service + REST

**Files:**
- Create: `core/services/property-access.ts`, `server/routes/property-access.ts`
- Modify: `server/app.ts`
- Test: `tests/property-access.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/property-access.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

async function createOrgViaApi(app: any, cookie: string, name: string) {
  const res = await app.request('/api/organizations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name }),
  });
  return (await res.json()).organization;
}
async function createPropertyViaApi(app: any, cookie: string, name: string) {
  const res = await app.request('/api/properties', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name }),
  });
  return (await res.json()).property;
}

describe('property access', () => {
  it('grant + list + revoke', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    const org = await createOrgViaApi(app, cookie, 'O');
    const prop = await createPropertyViaApi(app, cookie, 'Byt 1');

    // We grant to ourselves for now; in Plan 1 there's no invite flow yet.
    const grant = await app.request('/api/property-access', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ membershipId: org.membershipId, propertyId: prop.id }),
    });
    expect(grant.status).toBe(201);

    const list = await app.request(`/api/property-access?membershipId=${org.membershipId}`, { headers: { cookie } });
    const body = await list.json();
    expect(body.propertyIds).toEqual([prop.id]);

    const rev = await app.request(`/api/property-access?membershipId=${org.membershipId}&propertyId=${prop.id}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(rev.status).toBe(204);
    client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/property-access.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement service**

`core/services/property-access.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { propertyAccess, membership, property } from '../db/schema.js';
import { AppError } from '../errors.js';

export async function grantPropertyAccess(db: DB, orgId: string, membershipId: string, propertyId: string) {
  const m = await db.select().from(membership).where(eq(membership.id, membershipId)).get();
  if (!m || m.orgId !== orgId) throw new AppError('not_found', 'membership not in org');
  const p = await db.select().from(property).where(eq(property.id, propertyId)).get();
  if (!p || p.orgId !== orgId) throw new AppError('not_found', 'property not in org');
  await db.insert(propertyAccess).values({ membershipId, propertyId }).onConflictDoNothing();
}

export async function listPropertyAccess(db: DB, orgId: string, membershipId: string): Promise<string[]> {
  const m = await db.select().from(membership).where(eq(membership.id, membershipId)).get();
  if (!m || m.orgId !== orgId) throw new AppError('not_found', 'membership not in org');
  const rows = await db.select().from(propertyAccess).where(eq(propertyAccess.membershipId, membershipId));
  return rows.map((r) => r.propertyId);
}

export async function revokePropertyAccess(db: DB, orgId: string, membershipId: string, propertyId: string) {
  const m = await db.select().from(membership).where(eq(membership.id, membershipId)).get();
  if (!m || m.orgId !== orgId) throw new AppError('not_found', 'membership not in org');
  await db.delete(propertyAccess).where(
    and(eq(propertyAccess.membershipId, membershipId), eq(propertyAccess.propertyId, propertyId)),
  );
}
```

- [ ] **Step 4: Implement route**

`server/routes/property-access.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { grantPropertyAccess, listPropertyAccess, revokePropertyAccess }
  from '../../core/services/property-access.js';
import type { DB } from '../../core/db/client.js';

const Grant = z.object({ membershipId: z.string(), propertyId: z.string() });

export function propertyAccessRoutes() {
  const r = new Hono();

  r.post('/property-access', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    if (ctx.role !== 'owner') throw new (await import('../../core/errors.js')).AppError('forbidden', 'owner only');
    const body = Grant.parse(await c.req.json());
    const db = c.get('db') as DB;
    await grantPropertyAccess(db, ctx.orgId, body.membershipId, body.propertyId);
    return c.json({ ok: true }, 201);
  });

  r.get('/property-access', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const membershipId = c.req.query('membershipId');
    if (!membershipId) throw new (await import('../../core/errors.js')).AppError('bad_request', 'membershipId required');
    const db = c.get('db') as DB;
    const propertyIds = await listPropertyAccess(db, ctx.orgId, membershipId);
    return c.json({ propertyIds });
  });

  r.delete('/property-access', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    if (ctx.role !== 'owner') throw new (await import('../../core/errors.js')).AppError('forbidden', 'owner only');
    const membershipId = c.req.query('membershipId');
    const propertyId = c.req.query('propertyId');
    if (!membershipId || !propertyId) throw new (await import('../../core/errors.js')).AppError('bad_request', 'membershipId + propertyId required');
    const db = c.get('db') as DB;
    await revokePropertyAccess(db, ctx.orgId, membershipId, propertyId);
    return c.body(null, 204);
  });

  return r;
}
```

(Refactor the `await import` lines into a top-level import in your IDE — kept as-is here for atomicity.)

Mount: `app.route('/api', propertyAccessRoutes());`

- [ ] **Step 5: Run test, commit**

Run: `pnpm test tests/property-access.test.ts`
Expected: PASS.

```bash
git add core/services/property-access.ts server/routes/property-access.ts server/app.ts tests/property-access.test.ts
git commit -m "feat: property-access grant/list/revoke (owner only)"
```

---

### Task 16: ApiToken service + REST

**Files:**
- Create: `core/services/api-token.ts`, `server/routes/api-tokens.ts`
- Modify: `server/app.ts`
- Test: `tests/api-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/api-tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

describe('api tokens', () => {
  it('issues, lists (hash-suppressed), and revokes a token; created token authenticates /api/me', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'A');
    await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'O' }),
    });

    const create = await app.request('/api/api-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'mcp-laptop' }),
    });
    expect(create.status).toBe(201);
    const body = await create.json();
    expect(body.token).toMatch(/^rmt_[a-f0-9]{64}$/);
    expect(body.id).toBeTruthy();

    const me = await app.request('/api/me', { headers: { authorization: `Bearer ${body.token}` } });
    expect(me.status).toBe(200);

    const list = await app.request('/api/api-tokens', { headers: { cookie } });
    const listBody = await list.json();
    expect(listBody.tokens).toHaveLength(1);
    expect(listBody.tokens[0].token).toBeUndefined();
    expect(listBody.tokens[0].tokenHash).toBeUndefined();

    const del = await app.request(`/api/api-tokens/${body.id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(204);

    const meAfter = await app.request('/api/me', { headers: { authorization: `Bearer ${body.token}` } });
    expect(meAfter.status).toBe(401);
    client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/api-tokens.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement service**

`core/services/api-token.ts`:

```ts
import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { apiToken, membership } from '../db/schema.js';
import { generateToken, hashToken } from '../auth/token.js';
import { AppError } from '../errors.js';

export interface TokenSummary {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function issueApiToken(db: DB, membershipId: string, name: string): Promise<{ id: string; token: string; name: string }> {
  const m = await db.select().from(membership).where(eq(membership.id, membershipId)).get();
  if (!m) throw new AppError('not_found', 'membership not found');
  const token = generateToken();
  const id = createId();
  await db.insert(apiToken).values({ id, membershipId, name, tokenHash: hashToken(token) });
  return { id, token, name };
}

export async function listApiTokens(db: DB, membershipId: string): Promise<TokenSummary[]> {
  const rows = await db
    .select({
      id: apiToken.id, name: apiToken.name, lastUsedAt: apiToken.lastUsedAt, createdAt: apiToken.createdAt,
    })
    .from(apiToken)
    .where(eq(apiToken.membershipId, membershipId));
  return rows;
}

export async function revokeApiToken(db: DB, membershipId: string, tokenId: string) {
  const result = await db.delete(apiToken)
    .where(and(eq(apiToken.id, tokenId), eq(apiToken.membershipId, membershipId)));
  if (result.rowsAffected === 0) throw new AppError('not_found', 'token not found');
}
```

- [ ] **Step 4: Implement route**

`server/routes/api-tokens.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { issueApiToken, listApiTokens, revokeApiToken } from '../../core/services/api-token.js';
import type { DB } from '../../core/db/client.js';

const CreateToken = z.object({ name: z.string().min(1).max(120) });

export function apiTokenRoutes() {
  const r = new Hono();

  r.post('/api-tokens', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const body = CreateToken.parse(await c.req.json());
    const db = c.get('db') as DB;
    const created = await issueApiToken(db, ctx.membershipId, body.name);
    return c.json(created, 201);
  });

  r.get('/api-tokens', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const db = c.get('db') as DB;
    const tokens = await listApiTokens(db, ctx.membershipId);
    return c.json({ tokens });
  });

  r.delete('/api-tokens/:id', async (c) => {
    const ctx = getCtx(c);
    requireOrg(ctx);
    const db = c.get('db') as DB;
    await revokeApiToken(db, ctx.membershipId, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
```

Mount: `app.route('/api', apiTokenRoutes());`

- [ ] **Step 5: Run test, commit**

Run: `pnpm test tests/api-tokens.test.ts`
Expected: PASS.

```bash
git add core/services/api-token.ts server/routes/api-tokens.ts server/app.ts tests/api-tokens.test.ts
git commit -m "feat: api-token issue/list/revoke (per-membership Bearer)"
```

---

### Task 17: /api/me returns user + memberships

**Files:**
- Modify: `server/routes/me.ts`
- Test: `tests/me.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/me.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

describe('GET /api/me', () => {
  it('returns user and all memberships', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);
    const { cookie } = await registerUser(app, 'a@b.cz', 'password123', 'Alice');
    await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'A' }),
    });
    await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'B' }),
    });
    const res = await app.request('/api/me', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('a@b.cz');
    expect(body.memberships).toHaveLength(2);
    expect(body.activeOrgId).toBeTruthy();
    client.close();
  });
});
```

- [ ] **Step 2: Update `/api/me` to assemble the response**

`server/routes/me.ts`:

```ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { getCtx } from '../middleware/auth.js';
import type { DB } from '../../core/db/client.js';
import { user, membership, organization } from '../../core/db/schema.js';

export function meRoutes() {
  const r = new Hono();
  r.get('/me', async (c) => {
    const ctx = getCtx(c);
    const db = c.get('db') as DB;
    const u = await db.select().from(user).where(eq(user.id, ctx.userId)).get();
    if (!u) throw new (await import('../../core/errors.js')).AppError('not_found', 'user gone');
    const memberships = await db
      .select({
        membershipId: membership.id,
        orgId: membership.orgId,
        orgName: organization.name,
        role: membership.role,
      })
      .from(membership)
      .innerJoin(organization, eq(organization.id, membership.orgId))
      .where(eq(membership.userId, ctx.userId));
    return c.json({
      user: { id: u.id, email: u.email, name: u.name },
      memberships,
      activeOrgId: ctx.orgId,
    });
  });
  return r;
}
```

- [ ] **Step 3: Run test, commit**

Run: `pnpm test tests/me.test.ts`
Expected: PASS.

```bash
git add server/routes/me.ts tests/me.test.ts
git commit -m "feat: /api/me returns user + memberships + activeOrgId"
```

---

### Task 18: Update lastUsedAt on token authentication

**Files:**
- Modify: `server/middleware/auth.ts`
- Test: extend `tests/auth-middleware.test.ts`

- [ ] **Step 1: Add the failing test case**

Append to `tests/auth-middleware.test.ts`:

```ts
import { sql as rawSql } from 'drizzle-orm';
import { apiToken as apiTokenTable } from '../core/db/schema.js';

it('updates lastUsedAt on bearer auth', async () => {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { userId } = await registerUser(app, 'a@b.cz', 'password123', 'A');
  const org = await createOrganization(db, { userId, name: 'O' });
  const t = generateToken();
  await db.insert(apiTokenTable).values({
    id: 'at1', membershipId: org.membershipId, name: 't', tokenHash: hashToken(t),
  });

  const before = await db.select().from(apiTokenTable).where(rawSql`id = 'at1'`).get();
  expect(before?.lastUsedAt).toBeNull();

  await app.request('/api/me', { headers: { authorization: `Bearer ${t}` } });
  const after = await db.select().from(apiTokenTable).where(rawSql`id = 'at1'`).get();
  expect(after?.lastUsedAt).toBeTruthy();
  client.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/auth-middleware.test.ts`
Expected: FAIL on the new case.

- [ ] **Step 3: Update middleware to bump `lastUsedAt`**

In the Bearer branch of `authMiddleware`, after finding the row:

```ts
await db.update(apiToken)
  .set({ lastUsedAt: new Date().toISOString() })
  .where(eq(apiToken.id, row.id));
```

- [ ] **Step 4: Run test, commit**

Run: `pnpm test tests/auth-middleware.test.ts`
Expected: all PASS.

```bash
git add server/middleware/auth.ts tests/auth-middleware.test.ts
git commit -m "feat: bump apiToken.lastUsedAt on bearer auth"
```

---

### Task 19: Node entrypoint + dev script

**Files:**
- Create: `server/node.ts`

- [ ] **Step 1: Implement**

```ts
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createDb } from '../core/db/client.js';
import { buildApp } from './app.js';

const url = process.env.DATABASE_URL ?? 'file:./data/rental.sqlite';
const { db } = createDb(url);
const app = buildApp({ db });

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`rental-management listening on http://localhost:${port}`);
});
```

- [ ] **Step 2: Manual smoke test**

Run:
```bash
mkdir -p data
pnpm db:migrate
pnpm dev
```
In a second shell:
```bash
curl -i http://localhost:3000/api/me
```
Expected: HTTP 401 with JSON `{"error":{"kind":"unauthenticated", ...}}`.

Stop the server (Ctrl-C).

- [ ] **Step 3: Commit**

```bash
git add server/node.ts
git commit -m "feat: node entrypoint with dotenv + libsql"
```

---

### Task 20: Full end-to-end happy path test

**Files:**
- Test: `tests/e2e-happy-path.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

describe('end-to-end: register → org → token → property → access', () => {
  it('exercises the whole Plan 1 surface', async () => {
    const { db, client } = await freshDb();
    const app = makeApp(db);

    const { cookie } = await registerUser(app, 'esnerda@gmail.com', 'password123', 'David');

    const orgRes = await app.request('/api/organizations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'David rentals' }),
    });
    expect(orgRes.status).toBe(201);
    const org = (await orgRes.json()).organization;

    const tokRes = await app.request('/api/api-tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'mcp-laptop' }),
    });
    expect(tokRes.status).toBe(201);
    const { token } = await tokRes.json();

    const me = await app.request('/api/me', { headers: { authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(meBody.memberships[0].orgId).toBe(org.id);
    expect(meBody.memberships[0].role).toBe('owner');

    const propRes = await app.request('/api/properties', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Kolčavka A12' }),
    });
    expect(propRes.status).toBe(201);
    const prop = (await propRes.json()).property;

    const grant = await app.request('/api/property-access', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ membershipId: org.membershipId, propertyId: prop.id }),
    });
    expect(grant.status).toBe(201);

    const list = await app.request(`/api/property-access?membershipId=${org.membershipId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.status).toBe(200);
    expect((await list.json()).propertyIds).toEqual([prop.id]);

    client.close();
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm test tests/e2e-happy-path.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e-happy-path.test.ts
git commit -m "test: end-to-end happy path covering register/org/token/property/access"
```

---

### Task 21: Run full suite + tag plan-1 complete

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 2: Type check**

Run: `pnpm build`
Expected: exits 0.

- [ ] **Step 3: Tag**

```bash
git tag plan-1-complete
```

---

## Self-Review

**Coverage vs spec (sections 2.1, 3.1, 4.1, 6.2, 6.3 of spec):**
- 2.1 Multi-tenant SaaS ✅ (Org/Membership/PropertyAccess)
- 3.1 Stack (Hono, Drizzle, libSQL, better-auth, Zod, Vitest) ✅
- 4.1 Identity schema (User/Credential≈account/Session/Org/Membership/PropertyAccess/ApiToken) ✅
- 6.2 Auth (cookie session + Bearer token) ✅
- 6.3 Idempotence on payments — out of scope (Plan 3)

**Out-of-scope for Plan 1 (handled later):**
- Full Property schema → Plan 2
- Tenant, Contract, ContractTerms, ContractUtility, PropertyServiceTariff → Plan 2
- Payment, CostStatement → Plan 3
- Reconciliation → Plan 4
- MCP server → Plan 5
- UI → Plan 6
- Docker / Vercel → Plan 7

**Type consistency checked:**
- `AuthContext` updated in Task 13 to allow nulls; later tasks (15, 16, 17) call `requireOrg` to narrow. ✅
- `Auth`, `DB` types imported consistently from their definers. ✅
- `OrgWithRole` returned from `createOrganization` and `listOrganizationsForUser`. ✅
- `apiToken.tokenHash` queried via `eq` against `hashToken(token)` in middleware and tests. ✅

**Placeholder scan:** No TBD/TODO/"appropriate handling" in steps. All code shown inline. ✅
