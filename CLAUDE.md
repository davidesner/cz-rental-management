# CLAUDE.md

## Project

Personal rental-management SaaS: tracks rental contracts + payments + cost statements, computes annual reconciliation (refund/owe number) between landlord and tenant. See `@README.md` and `@package.json` for stack and scripts.

## Commands you can't guess

```bash
# Tests need an admin Postgres URL — each test provisions its own disposable DB
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" pnpm test

# `pnpm build` is type-check only (tsc --noEmit); use vercel-build for actual Vite output
pnpm vercel-build

# MCP server runs locally at the user (stdio), never deployed
pnpm mcp
```

`pnpm dev` runs API on :3000 + Vite on :5173. Local Postgres expected via Docker container `rental-pg`.

## Architecture (the non-obvious bits)

- **Monorepo with three entrypoints**: `api/` (Vercel serverless), `server/` (Node dev server), `mcp/` (standalone MCP server, stdio, runs at the user — NEVER deployed).
- **`core/` is framework-free**. All business logic lives in `core/services/*.ts` + `core/lib/*.ts` and is unit-testable in isolation. Routes (`server/routes/`) and MCP tools (`mcp/tools/`) are thin shells calling into `core/`.
- **DB client auto-switches pool size** based on `process.env.VERCEL` (`core/db/client.ts`). Don't add another switch — extend that one.

## Domain rules (REQUIRED knowledge)

**Money is integer haléře (CZK × 100), never float.** Format with `(v/100).toLocaleString('cs-CZ')`.

**Multi-tenant via `ctx.orgId`.** Every service function accepts `orgId` + `allowedPropertyIds` from `ctx`. NEVER trust `orgId` from request body. Auth middleware in `server/middleware/auth.ts` sets these.

**SCD2 temporal pattern** for `contract_terms`, `contract_utility`, `property_service_tariff`: `validFrom` + `validTo` (null = open). Lookups use `core/lib/temporal.ts#validAt`. To amend: insert new row + close prior open in a transaction. **Never mutate `validFrom`** of an existing row.

**Payment timing (`paymentDueDay`, `paymentAppliesTo`) lives on `contract_terms`, not `contract`.** It changes via amendments. Reconciliation reads per-month terms.

**Rent-first allocation** (`core/lib/allocation.ts`): rent → service advance → utilities. Underpayment deficit lands on advances, not rent. Rent reduction (srážka) applied as `rentEffective = max(0, baseRent − reduction)` BEFORE allocation.

**FIFO payment matching with `naturalMonth`** (`core/lib/payment-matching.ts`): payment lands on its naturalMonth slot; overflow only redirects to *completely unpaid* earlier slots. **One payment never splits across months** — surplus stays per-slot.

**Per-kind `matchPeriod` for reconciliation**: union of cost statements whose `periodFrom` is inside the recon period. **Auto-shift** when a prior statement (same kind) ends in our start month — shifts forward to avoid double-count across years.

**Reconciliation persists totals only.** Breakdown is recomputed on every GET. UI flags stale persisted vs live values.

## Conventions

- Add a field: schema → `pnpm db:generate` → edit migration SQL if needed → `pnpm db:migrate` → update service, route, MCP tool, UI page, test. Test with `freshDb()` helper.
- **`claude-plugin/` changes**: bump `claude-plugin/.claude-plugin/plugin.json#version` (semver: patch = text fix, minor = new sub-skill/command, major = workflow break) + add `claude-plugin/CHANGELOG.md` entry. Local user skill copies won't see updates without a version bump.
- **No real PII in code or docs.** Use `<placeholder>` style for names/addresses/amounts in examples and tests.
- **Don't commit `.mcp.json`** — contains API tokens.
- **Don't compute money in the LLM head.** Write Python scripts (`claude-plugin/templates/skill/scripts/`) for arithmetic. The plugin skill explicitly forbids in-head math.

## Reference

- `tests/reference-property-2024.test.ts` — full reconciliation E2E producing a stable reference number. **If this breaks, the math regressed.**
- `@DEPLOY.md` — Vercel + Neon deployment checklist.
- `@claude-plugin/templates/skill/SKILL.md` — end-user workflow skill (annual reconciliation).
