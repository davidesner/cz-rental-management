# Loading states and server-side name resolution

**Date:** 2026-08-19
**Status:** approved design, not yet implemented

## Problem

Two user-visible defects with one shared root cause: the UI treats *"still
loading"* as *"empty or missing"*.

**1. Empty states appear during loading.** Every list page renders
`(data?.items ?? []).map(...)`. While the query is in flight `data` is
`undefined`, so the array is empty and the table renders its empty-state row.
The user is told "Zatím žádné nemovitosti" before the request has come back.

**2. Raw IDs render before names.** Contracts, properties and tenants are three
independent queries. The contracts response usually lands first, so the table
paints with raw cuids and swaps to names a moment later:

```tsx
// src/pages/Contracts.tsx:86,97
{tenant?.name ?? c.tenantId}
{property ? <Link>{property.name}</Link> : c.propertyId}
```

`src/pages/Payments.tsx:112` is worse — it renders `p.contractId` with no
lookup at all, so a raw cuid is shown *permanently*, not just during loading.

Current state:

| | |
|---|---|
| Pages with queries | 9 |
| `useQuery` call sites | 33 |
| `?? []` "undefined means empty" sites | 34 |
| Pages with **no** loading handling | 6 — ApiTokens, Contracts, CostStatements, Payments, Properties, Tenants |

Removing the `/api/me` render gate (`perf/reduce-auth-roundtrips`) made both
defects more visible, because pages now paint earlier rather than behind a
single app-wide "Načítání…".

## Goals

- A list never shows an empty state until its data has actually loaded.
- A raw ID is never shown where a human-readable name belongs.
- No layout shift when data arrives.

## Non-goals

- No schema change or migration — names are derived at read time.
- No endpoints beyond contracts and payments.
- No `keepPreviousData` / refetch-dimming behaviour.
- No redesign of existing empty-state copy.

## Design

### 1. Resolve names server-side, via SQL joins

Chosen over resolving on the client because a client-side join cannot avoid the
flicker: it is a race between independent requests by construction.

Considered and rejected:

- **Separate lookups mapped in the service** — simpler SQL, but spends 3
  round-trips where 1 will do. A DB round-trip currently costs ~150ms in
  production, so adding queries is the wrong direction.
- **Denormalise names onto the rows** — needs a migration and goes stale.

`leftJoin`, not `innerJoin`, so a payment with no contract still returns its
row with null names.

### 2. API shape — additive only

```
ContractRow  + tenantName:   string        + propertyName: string
PaymentRow   + tenantName:   string | null + propertyName: string | null
```

No existing field is removed or renamed. The reference test and MCP consumers
keep working unchanged.

The server returns **names, not a formatted label**. Presentation stays in the
UI, where `src/pages/Payments.tsx:45` already composes `"Property / Tenant"`.

Payment names are nullable because `payment.contractId` is nullable — an
unassigned payment has no contract, hence no tenant or property.

### 3. Services

| File | Function | Change |
|---|---|---|
| `core/services/contract.ts` | `listContracts`, `getContract` | `leftJoin` tenant + property, select names |
| `core/services/payment.ts` | `listPayments`, `getPayment` | `leftJoin` contract → tenant + property |

`allowedPropertyIds` filtering must be preserved exactly. Note that
`listPayments` already issues a second query to resolve allowed contracts when
`allowedPropertyIds !== null` (`core/services/payment.ts:126`); the join can
absorb that, removing a round-trip for member-role users.

`listPayments` currently returns `rows as PaymentRow[]`. That cast must go —
with an explicit select list the row type is derived, and the cast would hide a
mismatch.

### 4. Loading states

One shared component, `src/components/ui/table-skeleton.tsx`:

```tsx
<TableSkeleton cols={4} rows={3} />
```

Grey placeholder bars in the real table shape, so the layout does not shift
when data lands.

Every list adopts a strict three-state rule:

| state | render |
|---|---|
| `isPending` | `<TableSkeleton>` |
| loaded, `length === 0` | existing empty-state row |
| loaded, has rows | the rows |

This retires the `(data?.x ?? [])` idiom, which is what conflates the first two
states. Each of the 34 occurrences is resolved one of two ways, explicitly:

- **Feeds a list render** → converted to the three-state rule.
- **Feeds something else** (a `<Select>` of options, a `.find()`, a derived
  count) → left as-is, because an empty array is a correct neutral value there
  and no empty-state message is shown to the user.

The 6 pages with no loading handling get the full treatment; the other 3 are
audited for the same conflation.

The same bug class was already found in `src/pages/Dashboard.tsx` during review
of `perf/reduce-auth-roundtrips` — `(me?.memberships ?? []).length === 0` told
users with an org to go create one while `/api/me` was in flight. That fix is
the pattern this spec generalises.

### 5. Client cleanup

`Contracts.tsx` and `ContractDetail.tsx` drop their `propertiesById` /
`tenantsById` maps for *display*. They keep fetching properties and tenants,
because the create-form dropdowns need them — **request count is unchanged**;
what changes is that the table no longer waits on them.

`Payments.tsx:112` renders the resolved name instead of `p.contractId`.

### 6. MCP

`mcp/tools/contracts.ts` and `mcp/tools/payments.ts` pass responses through as
`unknown[]` with no output schema, so the new fields surface automatically. No
change required — verified, not assumed. Names in MCP output are a side
benefit: they reduce the chance of an agent mixing up cuids.

## Testing

Service level (`tests/contracts.test.ts`, `tests/payments.test.ts`):

- `listContracts` / `getContract` return `tenantName` and `propertyName`.
- `listPayments` returns null names for an unassigned payment.
- A member-role user with `allowedPropertyIds` sees exactly the same rows as
  before the join — the join must not widen or narrow visibility.
- Cross-org isolation: a contract in another org is not reachable through the
  join.

Regression:

- `tests/reference-property-2024.test.ts` must stay green — it is the guard
  that the reconciliation maths has not moved.
- Full suite (44 files / 274 tests) green.

Not covered by automated tests: the skeleton rendering itself. There is no
component-test setup in this repo (no jsdom/testing-library) and adding one is
out of scope. The three-state rule is verified by reading and by manual check
of one representative page.

## Risks

- **Join changes row visibility.** A wrong join type could drop rows (payments
  with no contract) or duplicate them. Mitigated by `leftJoin` plus the
  visibility tests above.
- **Row-type drift.** Dropping the `as PaymentRow[]` cast may surface existing
  type mismatches. That is the point; fix them rather than re-adding the cast.
- **Overlap with the open PR #2.** `src/pages/Dashboard.tsx` is touched by both.
  If PR #2 merges first, rebase this branch onto it.
