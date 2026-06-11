# Security & Better Auth review — 2026-06-11

Pre-public-deploy audit. Scope: Better Auth configuration, auth middleware, multi-tenant authorization, HTTP layer, input handling, dependency surface.

## Summary

| Severity | Count | Status after this PR |
|---|---|---|
| Critical | 2 | fixed |
| High | 5 | fixed (or accepted, see #4) |
| Medium | 7 | fixed / partially fixed |
| Low | 7 | fixed where cheap; rest tracked |

**The multi-tenant authorization layer (`orgId` + `allowedPropertyIds` plumbed into every service function) was reviewed across every resource and found consistently applied — no IDOR vectors found in the routes/services as written.**

---

## Findings

### Critical

#### C1. Hardcoded secret fallback
- **File:** `core/auth/better-auth.ts:19`
- **Was:** `secret: process.env.BETTER_AUTH_SECRET ?? 'dev-secret-do-not-use'`
- **Risk:** if `BETTER_AUTH_SECRET` is ever missing in any environment (typo, redeploy on preview, accidental env var deletion) the app boots with a publicly-known secret string. Session cookies become forgeable by anyone reading the repo.
- **Fix:** fail-fast on boot when secret missing or shorter than 32 chars. Same treatment for `BETTER_AUTH_URL`.

#### C2. `trustedOrigins` defaults to localhost only
- **File:** `core/auth/better-auth.ts:22-24`
- **Risk:** If `BETTER_AUTH_TRUSTED_ORIGINS` env var is missing in production, Better Auth rejects all requests from the production web origin (CSRF/origin check fails). Worse — a misconfigured value silently weakens CSRF protection.
- **Fix:** fail-fast if running outside test/dev without a non-localhost trusted origin configured.

### High

#### H1. No rate limiting on auth endpoints
- **File:** `core/auth/better-auth.ts`
- **Risk:** credential stuffing on `/api/auth/sign-in/email` is unbounded. With `requireEmailVerification: false`, signup spam vector (now moot — see H3).
- **Fix:** enable Better Auth's built-in `rateLimit` with database storage (memory storage is per-instance, useless on serverless).

#### H2. No password strength configuration
- **File:** `core/auth/better-auth.ts:25`
- **Risk:** default minimum length is 8 with no complexity. Weak passwords on a multi-tenant app.
- **Fix:** explicit `minPasswordLength: 10`, `maxPasswordLength: 128`.

#### H3. Public registration enabled
- **File:** `core/auth/better-auth.ts:25`, `src/pages/Register.tsx`, `src/main.tsx`
- **Risk:** combined with the `user.create.after` hook that auto-creates an organization for every user, any unauthenticated visitor can register and write rows to the DB without bound.
- **Decision (user):** registration is now manual-only. UI page + route removed. API endpoint disabled in production via `disableSignUp` (still enabled under `VITEST=true` so the test suite — 60+ usages — keeps working).
- **Follow-up:** added `scripts/create-user.ts` for manual provisioning.

#### H4. No HTTP security headers
- **File:** `server/app.ts`
- **Risk:** no CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permission-Policy. Leaves clickjacking, MIME-sniffing, and a wide XSS surface on the SPA (React's default escaping helps but isn't comprehensive).
- **Fix:** add `hono/secure-headers` middleware with strict CSP.

#### H5. Signup endpoint leaks error messages
- **File:** `src/pages/Register.tsx:28`
- **Risk:** echoed Better Auth error strings allow email enumeration (`USER_ALREADY_EXISTS`).
- **Fix:** moot — Register page removed (H3).

### Medium

#### M1. Vulnerable transitive `esbuild`
- **Source:** `pnpm audit` → `drizzle-kit > @esbuild-kit/... > esbuild <=0.24.2` (GHSA-67mh-4wv8-2f99)
- **Risk:** dev-only; affects the dev server's CORS handling.
- **Fix:** `pnpm.overrides` pinning esbuild to `>=0.25`.

#### M2. Unbounded + non-transactional payment batch
- **File:** `core/services/payment.ts:70` (`recordPaymentsBatch`)
- **Risk:** any array length accepted; loop runs N SELECTs + INSERTs sequentially with no transaction. Massive batch locks a function instance for minutes; failure mid-loop leaves partial state.
- **Fix:** cap at 500 items per call, wrap in `db.transaction()`.

#### M3. No pagination on list endpoints
- **Files:** `server/routes/payments.ts`, `properties.ts`, `contracts.ts`, `tenants.ts`, etc.
- **Risk:** unbounded response sizes; eventual DoS on large orgs.
- **Status:** tracked. Not fixed in this pass — invasive across many endpoints. Will add cursor-based pagination once data volumes warrant it.

#### M4. `pickMembership` order is non-deterministic
- **File:** `server/middleware/auth.ts:11-15`
- **Risk:** for users in multiple orgs, "first membership wins" relies on unspecified row order. Not a security hole, but a footgun.
- **Fix:** explicit `orderBy(membership.createdAt)`.

#### M5. Unnecessary cast in auth route handler
- **File:** `server/routes/auth.ts:14`
- **Was:** `auth.handler(c.req.raw as unknown as Request)`
- **Risk:** masks a type mismatch if Hono ever changes `c.req.raw`.
- **Fix:** drop the `as unknown` — `c.req.raw` is already a `Request`.

#### M6. Tenant listing not property-scoped
- **File:** `server/routes/tenants.ts`, `core/services/tenant.ts`
- **Risk:** members granted access to a single property can list every tenant in the org including PII (name/email/phone).
- **Status:** documented as intentional (org-wide tenant directory). If this changes, filter via `tenant → contract → property → allowedPropertyIds`.

#### M7. Error middleware echoes `err.details` to client
- **File:** `server/middleware/errors.ts:16`
- **Risk:** if any service ever throws an `AppError` whose `details` contains internal state (DB error, env vars), it goes to the client.
- **Status:** all current callers pass safe primitives. Left as-is with audit note — revisit when adding new `AppError` call sites.

### Low / housekeeping

#### L1. API tokens have no expiry
- `api_token` table lacks `expiresAt` / `revokedAt`. Personal-use only currently. Add when multi-user.

#### L2. `lastUsedAt` write per Bearer request
- `server/middleware/auth.ts:36`: DB UPDATE on every API call. Low cost now; debounce if traffic grows.

#### L3. No per-user organization cap
- `POST /organizations` lets one user create unlimited orgs. Add a cap if you ever expose this UI.

#### L4. DEPLOY.md missing `BETTER_AUTH_TRUSTED_ORIGINS`
- **Fix:** added to the env var table.

#### L5. Frontend uses raw `fetch` instead of `better-auth/react` client
- `src/pages/Login.tsx`, `SignOutButton.tsx`. Works, but loses type safety and built-in session hooks. Defer.

#### L6. Health endpoint open
- `GET /api/health` returns `{ ok: true }` unauthenticated. Fine — just don't add build info or metrics here.

#### L7. No HSTS in app
- Vercel sets HSTS at the edge in production. Made explicit via `secure-headers` (H4).

---

## What's solid

- Multi-tenant `orgId` + `allowedPropertyIds` scoping consistently applied across **every** mutating and reading service: properties, contracts, contract-terms, contract-utilities, cost-statements, payments, reconciliations, rent-reductions, api-tokens.
- API tokens stored as SHA-256 hashes; plaintext returned only on creation; revoke is membership-scoped.
- Drizzle ORM throughout = no SQL-injection surface.
- Zod schemas on every mutating route body.
- `.env` + `.mcp.json` correctly gitignored.
- TypeScript strict + `noUncheckedIndexedAccess`.
- `requireOrg` is an assertion function — compiler refuses callers that skip it.
- React default escaping handles XSS for tenant/contract rendering checked.

---

## Out of scope for this pass

- Pagination across list endpoints (M3) — tracked.
- Email verification (made moot by manual-signup decision; reopen if registration ever goes public).
- Frontend migration to `better-auth/react` client (L5).
- Token rotation / expiry (L1).
