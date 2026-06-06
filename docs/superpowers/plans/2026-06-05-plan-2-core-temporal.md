# Plan 2 — Core domain + Temporal

**Goal:** Add Property (full), Tenant, Contract, ContractTerms (SCD2), ContractUtility (SCD2), PropertyServiceTariff (SCD2) with services, REST and temporal resolver.

**End state:** Sufficient to seed the <property-name-a> 2024 / <tenant-name> reference scenario via REST (Plan 4 will reconcile from it).

## Entities

- `property(id, orgId, name, address?, reconciliationSkill?, note?)` — extend stub from Plan 1.
- `tenant(id, orgId, name, email?, phone?, accountNumber?, note?)`.
- `contract(id, orgId, propertyId, tenantId, startDate, endDate?, securityDeposit?, note?)`.
- `contract_terms(id, contractId, validFrom, validTo?, baseRent, serviceAdvance, source, note?)`.
- `contract_utility(id, contractId, kind, validFrom, validTo?, monthlyAdvance, note?)` — `kind ∈ electricity|gas|internet|water|other`.
- `property_service_tariff(id, propertyId, validFrom, validTo?, totalSvjAdvance, deductibleAmount, deductibleNote?, note?)`.

All money in integer haléře (CZK × 100). Dates ISO `YYYY-MM-DD` strings (pg `date` type).

## Temporal helper

`core/lib/temporal.ts` exposes `validAt(rows, date)` that picks the row where `validFrom <= date < (validTo ?? +inf)`. Used by services and Plan 4 reconciliation.

## Services + REST

- For each entity: CRUD service in `core/services/<entity>.ts`, route in `server/routes/<entity>.ts`.
- All org-scoped via `requireOrg(ctx)` + `requirePropertyAccess(ctx, propertyId)` where relevant.
- SCD2 tables: create new row only; existing row's `validTo` set on next row creation. Helpers: `closeOpenAt(table, parentId, atDate)` then insert new row.

## Tests

Per entity: create + list + get + update + scope leak prevention (cross-org cannot see).
Temporal: validAt resolution across multiple rows, open-ended `validTo`, gap detection.

## Tasks (high-level)

1. Add 6 schema tables + generate migration + table existence test.
2. Temporal helper `validAt` + unit tests.
3. Property full CRUD service + routes + tests (extend stub).
4. Tenant CRUD service + routes + tests.
5. Contract CRUD service + routes + tests.
6. ContractTerms SCD2 service + routes + tests (`closeOpenAt` + insert).
7. ContractUtility SCD2 service + routes + tests.
8. PropertyServiceTariff SCD2 service + routes + tests.
9. End-to-end seed test reproducing <property-name-a> 2024 setup data (contract + terms + utility + tariff).
10. Tag `plan-2-complete`.
