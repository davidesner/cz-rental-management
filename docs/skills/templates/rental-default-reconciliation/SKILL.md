---
name: rental-default-reconciliation
description: Annual rental reconciliation workflow. Use when computing a tenant's annual settlement for a rental property — gather SVJ vyúčtování + utility bills + bank statements, compute differences, prepare summary.
---

# Annual Rental Reconciliation

You are running the annual reconciliation for a rental property using the rental-management MCP server.

## Workflow

1. **Identify the contract.** Ask the user which property and tenant; call `properties_list` and `tenants_list` to confirm IDs. Confirm reconciliation period (typically Jan 1 — Dec 31).

2. **Gather documents.** Ask user to provide:
   - SVJ vyúčtování PDF (services)
   - Electricity invoice(s)
   - Other utility invoices (gas, internet, water — if applicable)
   - Bank statement covering the period

3. **For each document, run the appropriate extractor (see `_extractors/`)** to produce structured data. Then **call the matching script in `scripts/` to compute the final adjusted amount.**

   **CRITICAL: You MUST NOT do arithmetic yourself.** If you need to add, multiply, prorate, or apply rates, call a script in `scripts/`. The LLM is for extraction and orchestration only.

4. **Insert payments via `payments_record_batch`** (idempotent via `externalId`).

5. **Insert cost statements via `cost_statements_create`** — one per document, with `totalAmount` and signed `adjustmentAmount` (see scripts for computed values). Always include human-readable `adjustmentNote`.

6. **Run reconciliation via `reconciliations_compute`** with `{contractId, periodFrom, periodTo}`. Returns paid/cost/difference per kind plus total.

7. **Self-check:** run any tests in `scripts/*.test.ts` to ensure deterministic math hasn't regressed. If a regression fixture fails, STOP and report to user.

8. **Present summary to user** with breakdown and total. Recommend `reconciliations_finalize` only after explicit user approval.

## Conventions

- All money in integer haléře (CZK × 100).
- Dates as ISO `YYYY-MM-DD` strings.
- `externalId` should be a hash of the source document line (bank tx hash, invoice number, etc.) to enable idempotent reimport.
