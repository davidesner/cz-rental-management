# Plan 4 — Reconciliation + <property-name-a> 2024 E2E

**Goal:** Implement allocation rule + reconciliation math + REST + Reconciliation entity, and a blessed E2E test seeding <property-name-a> 2024 / <tenant-name> data that produces +693 Kč ± 1 Kč diff.

## Reference math (verified against sheet)

**Contract:** <property-name-a> × <tenant-name>, start 2024-09-20.
**ContractTerms** valid 2024-09-20: baseRent <amount> Kč, serviceAdvance 7 000 Kč.
**ContractUtility(electricity)** valid 2024-09-20: monthlyAdvance 1 200 Kč.
**Period for reconciliation:** 2024-09-20 — 2024-12-31.

**Months in period:**
- September: 11 days (20-30); proration factor 11/30
- October: 31 days; full month
- November: 30 days; full month
- December: 31 days; full month

**Expected per month (in haléře, integer):**
- Sept: baseRent <amount> × 11/30 = <amount> Kč; serviceAdvance 7 000 × 11/30 ≈ 2 566.67 Kč; elAdvance 1 200 × 11/30 = 440 Kč. Total ≈ 15 106.67 Kč.
- Oct/Nov/Dec: <amount> + 7 000 + 1 200 = <deposit> Kč each.

**Payment seed (use plan amounts — see allocation note):**
- 2024-09-20: 15 107 Kč (`tx-sept`)
- 2024-10-10: <deposit> Kč (`tx-oct`)
- 2024-11-10: <deposit> Kč (`tx-nov`)
- 2024-12-10: <deposit> Kč (`tx-dec`)

(In reality November received 38 900 Kč and December 36 930 Kč; the difference was a one-off rent discount ("srazka z najmu"). MVP doesn't model discount — use plan amounts to verify reconciliation math.)

**CostStatement seeds (already proration-adjusted to contract period):**
- services: periodFrom 2024-09-20, periodTo 2024-12-31, totalAmount 29 999.49 Kč, adjustmentAmount −6 253.74 Kč (FO portion). Reconciliable = 23 745.75 Kč.
- electricity: periodFrom 2024-09-20, periodTo 2024-12-31, totalAmount 3 168.67 Kč, adjustmentAmount 0.

**Allocation rule choice (CRITICAL):** Allocate received-per-month in **utility-first** order (electricity/gas/internet/water/other → service → rent). Reason: utilities and SVJ services are pass-through obligations the landlord must pay regardless; rent is the landlord's discretionary amount. If tenant pays less, deficit lands on rent (semantically a rent discount). This matches the sheet's manual reconciliation and produces +693 Kč. **The earlier "rent first" wording in spec §5.2 is corrected to utility-first.**

**Expected reconciliation result:**
- Services paid: 2 567 + 7 000 + 7 000 + 7 000 = 23 567 Kč (with Sept service prorated to 7000 × 11/30 ≈ 2567)
- Services cost: 23 745.75 Kč
- Services diff: −178.75 Kč
- Electricity paid: 440 + 1 200 + 1 200 + 1 200 = 4 040 Kč
- Electricity cost: 3 168.67 Kč
- Electricity diff: +871.33 Kč
- **Total: +692.58 Kč ≈ +693 Kč** ✓

The E2E test asserts total diff is within ±100 haléře of +69 258 (≈ +693 Kč).

## Allocation library

`core/lib/allocation.ts` exposes:

```ts
interface MonthExpectation {
  baseRent: number;        // haléře, prorated to contract-active days in month
  serviceAdvance: number;  // haléře, prorated
  utilities: Record<UtilityKind, number>; // haléře per kind, prorated
}

interface MonthAllocation {
  baseRentPaid: number;
  servicePaid: number;
  utilityPaid: Record<UtilityKind, number>;
  surplus: number;     // unallocated (overpayment)
  deficit: { baseRent: number; serviceAdvance: number; utilities: Record<UtilityKind, number> }; // shortfalls
}

function expectedForMonth(contract, terms[], utilities[], year, month): MonthExpectation
function allocate(received: number, expectation: MonthExpectation): MonthAllocation
```

Order of allocation: electricity → gas → internet → water → other → service → rent.

## Reconciliation entity

```ts
reconciliation(id, orgId, contractId, periodFrom, periodTo, status:'draft'|'finalized', computedAt, note?, createdAt)
reconciliation_item(id, reconciliationId, kind, actualCost, paid, difference)
```

Service:
- `computeReconciliation(orgId, contractId, periodFrom, periodTo)` — creates Reconciliation (draft) + items per kind. Pure compute, no side effects beyond inserting Reconciliation rows.
- `listReconciliations(orgId, contractId?)`, `getReconciliation(orgId, id)`.
- `finalizeReconciliation(orgId, id)` — flips status.
- `deleteReconciliation(orgId, id)` — only when draft.

## REST

- `POST /api/contracts/:id/reconciliations/compute` with body `{periodFrom, periodTo}` → returns full reconciliation with items.
- `GET /api/reconciliations?contractId=`
- `GET /api/reconciliations/:id`
- `PATCH /api/reconciliations/:id/finalize`
- `DELETE /api/reconciliations/:id`

## Tasks

1. Allocation lib + unit tests.
2. Reconciliation schema + migration.
3. Reconciliation service + REST + integration tests.
4. <property-name-a> 2024 E2E (seeds via REST, computes, asserts +693 within tolerance).
5. Tag `plan-4-complete`.
