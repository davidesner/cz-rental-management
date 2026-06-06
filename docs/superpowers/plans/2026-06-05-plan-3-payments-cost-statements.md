# Plan 3 — Payments + CostStatement

**Goal:** Add Payment (bank-imported and manual) with idempotent `externalId` reimport, and CostStatement (incoming SVJ / utility bills) with `adjustmentAmount`. Both with REST + services. End state: data layer ready for Plan 4 reconciliation.

## Entities

- `payment(id, orgId, contractId?, amount, paidAt, counterparty?, counterpartyAccount?, externalId?, statementRef?, source, description?, note?, importedAt)`
  - `amount`: integer haléře
  - `paidAt`: pg `date` mode string (YYYY-MM-DD)
  - `source`: `'bank' | 'manual'`
  - `externalId`: nullable text, UNIQUE per (orgId, externalId) for idempotent reimport
  - `contractId`: nullable → in inbox until assigned
  - `importedAt`: timestamp with TZ, defaults to now()
- `cost_statement(id, orgId, propertyId, kind, periodFrom, periodTo, totalAmount, adjustmentAmount, adjustmentNote?, documentRef?, issuedAt?, note?, createdAt)`
  - `kind`: same enum as ContractUtility + `'services'`
  - Amounts: integer haléře, `adjustmentAmount` signed
  - `documentRef`: nullable text (e.g. SHA256 of source file)

## Services

- `payment.ts`: `recordPayment(orgId, input)`, `recordPaymentsBatch(orgId, inputs[])` (idempotent on externalId), `listPayments(orgId, filters)`, `getPayment(orgId, id)`, `assignPaymentToContract(orgId, paymentId, contractId)`, `updatePayment(...)`, `deletePayment(...)`.
- `cost-statement.ts`: full CRUD with property scope.

## REST

- `POST /api/payments` (single), `POST /api/payments/batch` (array; idempotent), `GET /api/payments` (filters: contractId, unassigned, period), `GET /api/payments/:id`, `PATCH /api/payments/:id`, `PATCH /api/payments/:id/assign` (sets contractId), `DELETE /api/payments/:id`.
- `POST /api/cost-statements`, `GET /api/cost-statements?propertyId=&kind=&period=`, `GET /api/cost-statements/:id`, `PATCH /api/cost-statements/:id`, `DELETE /api/cost-statements/:id`.

## Tests

- Idempotent batch import: insert same externalId twice, second is no-op (returns existing record).
- Cross-org scoping for both.
- Unassigned payments inbox query.
- CostStatement filter by kind and period.
- Adjustment can be negative.

## Tasks

1. Schema additions + migration + table tests.
2. Payment service + idempotent batch + REST + tests.
3. CostStatement service + REST + tests.
4. Tag `plan-3-complete`.
