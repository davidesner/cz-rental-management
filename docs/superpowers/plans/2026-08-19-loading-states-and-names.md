# Loading States and Server-Side Name Resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the UI showing empty states while loading and stop it showing raw cuids where names belong.

**Architecture:** Resolve `tenantName` / `propertyName` in SQL inside the service layer (additive fields, no migration), and adopt a strict loading → empty → data three-state rule in every list, backed by a shared `TableSkeleton` so the layout never shifts.

**Tech Stack:** TypeScript, Drizzle ORM (postgres-js), Hono, React 19, TanStack Query v5, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-loading-states-and-name-resolution-design.md`

## Global Constraints

- **Money is integer haléře (CZK × 100), never float.** Do not touch amount handling in these files.
- **Multi-tenant via `ctx.orgId`.** Every service function takes `orgId` + `allowedPropertyIds` from ctx. Never trust `orgId` from a request body.
- **No real PII in code or tests.** Use `<placeholder>` style, matching `tests/contracts.test.ts`.
- **Additive API changes only.** No existing field may be removed or renamed.
- **No schema change.** Names are derived at read time; no migration in this plan.
- **Join type follows FK nullability:** `innerJoin` for contract → property/tenant (`NOT NULL`); `leftJoin` for payment → contract (nullable).
- Run tests with: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run <path>`
- Typecheck with: `npx tsc --noEmit`
- The local Postgres container `rental-pg` must be running: `docker compose up -d pg`

---

### Task 1: Contract service returns tenant and property names

**Files:**
- Modify: `core/services/contract.ts` (`ContractRow` ~line 17, `listContracts` ~line 50, `getContract` ~line 57)
- Test: `tests/contracts.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ContractRow` gains `tenantName: string` and `propertyName: string`. Task 4 renders these.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('contracts REST', ...)` block in `tests/contracts.test.ts`:

```ts
  it('returns resolved tenant and property names on list and get', async () => {
    const { client, app, cookie, property, tenant } = await setup();
    const create = await app.request('/api/contracts', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ propertyId: property.id, tenantId: tenant.id, startDate: '2024-09-20' }),
    });
    const created = (await create.json() as any).contract;

    const listRes = await app.request('/api/contracts', { headers: { cookie } });
    const listed = (await listRes.json() as any).contracts[0];
    expect(listed.propertyName).toBe('<property-name-a>');
    expect(listed.tenantName).toBe('<tenant-name>');
    // IDs must survive — the change is additive.
    expect(listed.propertyId).toBe(property.id);
    expect(listed.tenantId).toBe(tenant.id);

    const getRes = await app.request(`/api/contracts/${created.id}`, { headers: { cookie } });
    const got = (await getRes.json() as any).contract;
    expect(got.propertyName).toBe('<property-name-a>');
    expect(got.tenantName).toBe('<tenant-name>');

    await client.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/contracts.test.ts -t "resolved tenant and property names"`
Expected: FAIL — `expected undefined to be '<property-name-a>'`

- [ ] **Step 3: Add the fields to `ContractRow`**

In `core/services/contract.ts`, extend the interface:

```ts
export interface ContractRow {
  id: string;
  orgId: string;
  propertyId: string;
  tenantId: string;
  startDate: string;
  endDate: string | null;
  securityDeposit: number | null;
  note: string | null;
  createdAt: Date;
  propertyName: string;
  tenantName: string;
}
```

- [ ] **Step 4: Add a shared select list and join helper**

Add above `listContracts` in `core/services/contract.ts`:

```ts
// contract.propertyId / tenantId are NOT NULL with ON DELETE restrict, so the
// joined rows always exist — innerJoin keeps the names non-nullable. A leftJoin
// here would force `string | null` on fields that can never be null.
const contractSelect = {
  id: contract.id,
  orgId: contract.orgId,
  propertyId: contract.propertyId,
  tenantId: contract.tenantId,
  startDate: contract.startDate,
  endDate: contract.endDate,
  securityDeposit: contract.securityDeposit,
  note: contract.note,
  createdAt: contract.createdAt,
  propertyName: property.name,
  tenantName: tenant.name,
};
```

- [ ] **Step 5: Rewrite `listContracts` and `getContract` to use it**

```ts
export async function listContracts(db: DB, orgId: string, allowedPropertyIds: string[] | null): Promise<ContractRow[]> {
  const rows = await db
    .select(contractSelect)
    .from(contract)
    .innerJoin(property, eq(property.id, contract.propertyId))
    .innerJoin(tenant, eq(tenant.id, contract.tenantId))
    .where(eq(contract.orgId, orgId));
  if (allowedPropertyIds === null) return rows;
  return rows.filter(r => allowedPropertyIds.includes(r.propertyId));
}

export async function getContract(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<ContractRow> {
  const [row] = await db
    .select(contractSelect)
    .from(contract)
    .innerJoin(property, eq(property.id, contract.propertyId))
    .innerJoin(tenant, eq(tenant.id, contract.tenantId))
    .where(and(eq(contract.id, id), eq(contract.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'contract not found');
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(row.propertyId)) {
    throw new AppError('forbidden', 'no access to contract\'s property');
  }
  return row;
}
```

Note: `updateContract` and `createContract` call `getContract` / return `row!` from an insert. `createContract`'s `.returning()` does **not** include the names. Fix it by returning `getContract(db, orgId, id, null)` after the insert instead of the raw row, so every `ContractRow` in the system carries names.

- [ ] **Step 6: Run the test to verify it passes**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/contracts.test.ts`
Expected: PASS, whole file green.

- [ ] **Step 7: Verify visibility did not change**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/property-access.test.ts tests/auth-middleware.test.ts tests/contracts.test.ts`
Expected: PASS. The join must not widen or narrow which contracts a user sees.

Cross-org isolation is already covered by existing cases in `tests/contracts.test.ts` — no new test needed for it, but those cases are the guard that the join did not leak across `orgId`, so treat a failure there as a blocker rather than a fixture problem.

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc --noEmit
git add core/services/contract.ts tests/contracts.test.ts
git commit -m "feat(contracts): resolve tenant and property names server-side"
```

---

### Task 2: Payment service returns tenant and property names

**Files:**
- Modify: `core/services/payment.ts` (`PaymentRow` ~line 20, `listPayments` ~line 117, `getPayment` ~line 133)
- Test: `tests/payments.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (independent service).
- Produces: `PaymentRow` gains `tenantName: string | null` and `propertyName: string | null`. Task 5 renders these.

- [ ] **Step 1: Write the failing test**

Append to `tests/payments.test.ts`, following the setup helper already in that file:

```ts
  it('returns contract names, and nulls for an unassigned payment', async () => {
    const { client, app, cookie, contract: c } = await setupWithContract();

    await app.request('/api/payments', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contractId: c.id, amount: 1200000, paidAt: '2024-10-01', source: 'manual' }),
    });
    await app.request('/api/payments', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ contractId: null, amount: 500000, paidAt: '2024-10-02', source: 'manual' }),
    });

    const res = await app.request('/api/payments', { headers: { cookie } });
    const payments = (await res.json() as any).payments as any[];

    const assigned = payments.find(p => p.contractId === c.id);
    expect(assigned.propertyName).toBe('<property-name-a>');
    expect(assigned.tenantName).toBe('<tenant-name>');

    const unassigned = payments.find(p => p.contractId === null);
    expect(unassigned).toBeDefined();               // leftJoin must not drop it
    expect(unassigned.propertyName).toBeNull();
    expect(unassigned.tenantName).toBeNull();

    await client.close();
  });
```

If `tests/payments.test.ts` has no `setupWithContract` helper, reuse whatever setup helper that file already defines and adapt the destructuring — do not invent a new fixture module.

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/payments.test.ts -t "returns contract names"`
Expected: FAIL — `expected undefined to be '<property-name-a>'`

- [ ] **Step 3: Add fields to `PaymentRow` and import the tables**

In `core/services/payment.ts`, change the import and interface:

```ts
import { payment, contract, property, tenant } from '../db/schema.js';
```

```ts
export interface PaymentRow {
  id: string;
  orgId: string;
  contractId: string | null;
  amount: number;
  paidAt: string;
  counterparty: string | null;
  counterpartyAccount: string | null;
  externalId: string | null;
  statementRef: string | null;
  source: 'bank' | 'manual';
  description: string | null;
  note: string | null;
  importedAt: Date;
  createdAt: Date;
  propertyName: string | null;
  tenantName: string | null;
}
```

- [ ] **Step 4: Add the select list**

Add above `listPayments`:

```ts
// payment.contractId is nullable (ON DELETE set null), so these are leftJoins
// and the names are nullable — an unassigned payment has no contract, and must
// still appear in the list.
const paymentSelect = {
  id: payment.id,
  orgId: payment.orgId,
  contractId: payment.contractId,
  amount: payment.amount,
  paidAt: payment.paidAt,
  counterparty: payment.counterparty,
  counterpartyAccount: payment.counterpartyAccount,
  externalId: payment.externalId,
  statementRef: payment.statementRef,
  source: payment.source,
  description: payment.description,
  note: payment.note,
  importedAt: payment.importedAt,
  createdAt: payment.createdAt,
  propertyName: property.name,
  tenantName: tenant.name,
  contractPropertyId: contract.propertyId,
};
```

`contractPropertyId` exists so the `allowedPropertyIds` filter can be applied without the extra query the current code makes.

- [ ] **Step 5: Rewrite `listPayments`**

```ts
export async function listPayments(db: DB, orgId: string, allowedPropertyIds: string[] | null, filters: ListFilters): Promise<PaymentRow[]> {
  const conds = [eq(payment.orgId, orgId)];
  if (filters.contractId) conds.push(eq(payment.contractId, filters.contractId));
  if (filters.unassigned) conds.push(isNull(payment.contractId));
  if (filters.from) conds.push(gte(payment.paidAt, filters.from));
  if (filters.to) conds.push(lte(payment.paidAt, filters.to));
  const rows = await db
    .select(paymentSelect)
    .from(payment)
    .leftJoin(contract, eq(contract.id, payment.contractId))
    .leftJoin(property, eq(property.id, contract.propertyId))
    .leftJoin(tenant, eq(tenant.id, contract.tenantId))
    .where(and(...conds))
    .orderBy(desc(payment.paidAt));
  const visible = allowedPropertyIds === null
    ? rows
    // unchanged rule: unassigned payments stay visible to everyone
    : rows.filter(r => r.contractPropertyId === null || allowedPropertyIds.includes(r.contractPropertyId));
  return visible.map(({ contractPropertyId: _ignored, ...row }) => row);
}
```

Do **not** re-add the `as PaymentRow[]` cast — with an explicit select the row type is derived, and the cast would hide a mismatch.

- [ ] **Step 6: Apply the same select to `getPayment`**

```ts
export async function getPayment(db: DB, orgId: string, id: string, allowedPropertyIds: string[] | null): Promise<PaymentRow> {
  const [row] = await db
    .select(paymentSelect)
    .from(payment)
    .leftJoin(contract, eq(contract.id, payment.contractId))
    .leftJoin(property, eq(property.id, contract.propertyId))
    .leftJoin(tenant, eq(tenant.id, contract.tenantId))
    .where(and(eq(payment.id, id), eq(payment.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'payment not found');
  if (allowedPropertyIds !== null && row.contractPropertyId !== null
      && !allowedPropertyIds.includes(row.contractPropertyId)) {
    throw new AppError('forbidden', 'no access to payment\'s property');
  }
  const { contractPropertyId: _ignored, ...rest } = row;
  return rest;
}
```

Read the existing `getPayment` body before replacing it and preserve its current authorisation behaviour exactly — if it differs from the above, keep the existing behaviour and only add the names.

- [ ] **Step 7: Run tests**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/payments.test.ts tests/payment-breakdown.test.ts tests/payment-matching.test.ts`
Expected: PASS. The breakdown and matching specs consume `PaymentRow`; they must be unaffected.

- [ ] **Step 8: Run the reference test**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/reference-property-2024.test.ts`
Expected: PASS. If this fails, the reconciliation maths moved — stop and investigate rather than adjusting the expected number.

- [ ] **Step 9: Typecheck and commit**

```bash
npx tsc --noEmit
git add core/services/payment.ts tests/payments.test.ts
git commit -m "feat(payments): resolve contract tenant and property names server-side"
```

---

### Task 3: Shared `TableSkeleton` component

**Files:**
- Create: `src/components/ui/table-skeleton.tsx`

**Interfaces:**
- Consumes: `TableRow`, `TableCell` from `src/components/ui/table.tsx`; `cn` from `src/lib/utils.ts`.
- Produces: `<TableSkeleton cols={number} rows?={number} />` — default `rows = 3`. Tasks 4, 5 and 6 all use this exact signature.

- [ ] **Step 1: Create the component**

```tsx
import { TableCell, TableRow } from './table';
import { cn } from '@/lib/utils';

interface TableSkeletonProps {
  /** Number of columns in the table — must match the header, or the layout shifts. */
  cols: number;
  /** Placeholder rows to draw. Default 3 — enough to read as "a list", short enough not to imply a count. */
  rows?: number;
  className?: string;
}

/**
 * Placeholder rows shaped like the real table.
 *
 * Exists so a loading list is visually distinct from an empty one. Rendering
 * `(data ?? []).map(...)` makes those two states identical, which is how the app
 * came to announce "Zatím žádné…" before its request had returned.
 */
export function TableSkeleton({ cols, rows = 3, className }: TableSkeletonProps) {
  // Varying widths so it reads as content rather than a progress bar.
  const widths = ['w-32', 'w-24', 'w-40', 'w-20', 'w-28', 'w-36'];
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r} aria-hidden="true">
          {Array.from({ length: cols }).map((_, c) => (
            <TableCell key={c}>
              <div className={cn('h-4 rounded bg-muted animate-pulse', widths[(r + c) % widths.length], className)} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
```

`aria-hidden` because placeholder bars are decorative — a screen reader should hear nothing rather than a table of blanks.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

There is no component-test setup in this repo (no jsdom or testing-library) and adding one is out of scope, so this task has no unit test. It is exercised visually in Tasks 4-6.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/table-skeleton.tsx
git commit -m "feat(ui): add TableSkeleton for loading lists"
```

---

### Task 4: Contracts list and detail use server-resolved names

**Files:**
- Modify: `src/pages/Contracts.tsx` (query ~line 25, maps ~lines 34-36, table body ~lines 75-100)
- Modify: `src/pages/ContractDetail.tsx` (the `propertiesById` / `tenantsById` display lookups)

**Interfaces:**
- Consumes: `ContractRow.tenantName` / `.propertyName` from Task 1; `<TableSkeleton>` from Task 3.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Extend the local `Contract` type**

In `src/pages/Contracts.tsx`, add to the `Contract` interface:

```ts
  propertyName: string;
  tenantName: string;
```

- [ ] **Step 2: Take `isPending` from the contracts query**

```tsx
const { data, isPending } = useQuery({ queryKey: ['contracts'], queryFn: () => api.get<{ contracts: Contract[] }>('/api/contracts') });
```

Keep the `properties` and `tenants` queries — the "Nový pronájem" dialog needs them for its dropdowns. Only the *table* stops depending on them.

- [ ] **Step 3: Render names, and the three states**

Replace the table body with:

```tsx
<TableBody>
  {isPending ? (
    <TableSkeleton cols={4} />
  ) : (data?.contracts ?? []).length === 0 ? (
    <TableRow>
      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">Zatím žádné pronájmy.</TableCell>
    </TableRow>
  ) : (
    (data?.contracts ?? []).map(c => (
      <TableRow
        key={c.id}
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => navigate(`/contracts/${c.id}`)}
      >
        <TableCell className="font-medium">{c.tenantName}</TableCell>
        <TableCell>
          <Link
            to={`/properties/${c.propertyId}`}
            className="underline text-primary hover:opacity-70"
            onClick={e => e.stopPropagation()}
          >
            {c.propertyName}
          </Link>
        </TableCell>
        {/* keep the remaining cells exactly as they are today */}
      </TableRow>
    ))
  )}
</TableBody>
```

Read the current cells for "Výše nájmu" and "Období" and carry them over unchanged — this step only replaces the name cells and adds the state branching.

- [ ] **Step 4: Delete the now-unused display maps**

Remove `propertiesById` and `tenantsById` **only if nothing else in the file uses them**. Grep first:

Run: `grep -n "propertiesById\|tenantsById" src/pages/Contracts.tsx`
If the create dialog uses them, keep them and delete only the unused one.

- [ ] **Step 5: Do the same in `ContractDetail.tsx`**

Run: `grep -n "propertiesById\|tenantsById" src/pages/ContractDetail.tsx`
Replace display reads with `contract.propertyName` / `contract.tenantName`. Leave lookups that feed form dropdowns alone.

- [ ] **Step 6: Typecheck and build**

Run: `npx tsc --noEmit && npx vite build`
Expected: both succeed.

- [ ] **Step 7: Verify in the browser**

Run: `docker compose up -d pg && pnpm dev`
Open `http://localhost:5173/contracts`. Throttle the network in DevTools to "Slow 3G" and reload. Expected: skeleton rows first, then names. **A raw cuid must never appear**, and the row height must not jump.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Contracts.tsx src/pages/ContractDetail.tsx
git commit -m "feat(web): render resolved names and loading skeletons on contracts"
```

---

### Task 5: Payments list shows a name instead of a cuid

**Files:**
- Modify: `src/pages/Payments.tsx` (`contractLabel` ~line 44, table body ~lines 106-129)

**Interfaces:**
- Consumes: `PaymentRow.tenantName` / `.propertyName` from Task 2; `<TableSkeleton>` from Task 3.

- [ ] **Step 1: Extend the local `Payment` type**

```ts
  propertyName: string | null;
  tenantName: string | null;
```

- [ ] **Step 2: Take `isPending` from the payments query**

```tsx
const { data, isPending } = useQuery({
  queryKey: ['payments', showUnassigned],
  queryFn: () => api.get<{ payments: Payment[] }>(`/api/payments${showUnassigned ? '?unassigned=true' : ''}`),
});
```

- [ ] **Step 3: Replace the raw id cell**

`src/pages/Payments.tsx:112` currently renders `{p.contractId ?? '—'}`, i.e. a cuid. Replace with:

```tsx
<TableCell>
  {p.contractId ? `${p.propertyName ?? '—'} / ${p.tenantName ?? '—'}` : '—'}
</TableCell>
```

The `"Property / Tenant"` order matches the existing `contractLabel` helper at line 44-45, which stays as-is because the assign-dialog dropdown still uses it.

- [ ] **Step 4: Add the three states**

```tsx
<TableBody>
  {isPending ? (
    <TableSkeleton cols={6} />
  ) : (data?.payments ?? []).length === 0 ? (
    <TableRow>
      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">Žádné platby.</TableCell>
    </TableRow>
  ) : (
    (data?.payments ?? []).map(p => (
      /* existing row markup, with the cell from Step 3 */
    ))
  )}
</TableBody>
```

Note this removes the separate `{(data?.payments ?? []).length === 0 && ...}` block that currently follows the map — it is now the middle branch.

- [ ] **Step 5: Typecheck, build, verify**

Run: `npx tsc --noEmit && npx vite build`
Then with `pnpm dev`, open `http://localhost:5173/payments` and confirm the "Pronájem" column shows `Property / Tenant`, never a cuid, and shows `—` for unassigned payments.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Payments.tsx
git commit -m "feat(web): show contract names instead of ids in payments"
```

---

### Task 6: Remaining lists get the three-state rule

**Files:**
- Modify: `src/pages/Properties.tsx` (~line 62), `src/pages/Tenants.tsx`, `src/pages/ApiTokens.tsx` (~line 95), `src/pages/CostStatements.tsx` (~line 241)

**Interfaces:**
- Consumes: `<TableSkeleton>` from Task 3.

- [ ] **Step 1: Apply the same pattern to each page**

For each file, take `isPending` from its list query and wrap its table body:

```tsx
{isPending ? (
  <TableSkeleton cols={N} />
) : items.length === 0 ? (
  <TableRow>
    <TableCell colSpan={N} className="text-center text-muted-foreground py-8">{/* existing empty text, unchanged */}</TableCell>
  </TableRow>
) : (
  items.map(/* existing row markup, unchanged */)
)}
```

`N` per page — read the `<TableHead>` count and the existing `colSpan`, they already agree:

| Page | cols |
|---|---|
| `Properties.tsx` | 3 |
| `ApiTokens.tsx` | 4 |
| `CostStatements.tsx` | 7 |
| `Tenants.tsx` | 3 |

Do not reword any empty-state copy.

- [ ] **Step 2: Audit the remaining `?? []` sites**

Run: `grep -rn "?? \[\]" src/pages/ src/components/`

For each hit, classify and act:
- **Feeds a list render** (its result is `.map`ped into rows, or its `.length === 0` drives an empty message) → convert to the three-state rule above.
- **Feeds anything else** — `<Select>` options, a `.find()`, a derived count — → **leave it**. An empty array is a correct neutral value there and no empty-state message reaches the user.

Record the classification in the commit message so the next reader knows the untouched ones were considered, not missed.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npx vite build`
Expected: both succeed.

- [ ] **Step 4: Full test suite**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run --exclude 'mcp/node_modules/**' --exclude 'node_modules/**' --exclude 'tests-e2e/**'`
Expected: 44 files / 274 tests pass (plus the two tests added in Tasks 1-2).

Note: a bare `npx vitest run` also picks up ~165 vendored zod test files under `mcp/node_modules/`, 3 of which fail on missing packages. Those are pre-existing and unrelated — use the excludes above.

- [ ] **Step 5: Verify the MCP tools still work and now carry names**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/mcp-tools-smoke.test.ts tests/mcp-client.test.ts`
Expected: PASS.

`mcp/tools/contracts.ts` and `mcp/tools/payments.ts` return `data.contracts` / `data.payments` typed as `unknown[]` with no output schema, so the new fields pass through untouched and need no code change. This step confirms that rather than assuming it.

- [ ] **Step 6: Verify no leaked test databases**

Run: `docker exec rental-pg psql -U postgres -tAc "select count(*) from pg_database where datname like 'test\_%';"`
Expected: `0`. Any new test you added must close its database in a `finally`.

- [ ] **Step 7: Commit**

```bash
git add src/pages/
git commit -m "feat(web): distinguish loading from empty in remaining lists"
```

---

## Done when

- No list shows an empty state while its query is in flight.
- No raw cuid appears anywhere a name belongs — verified on `/contracts` and `/payments` under Slow 3G throttling.
- `tests/reference-property-2024.test.ts` green.
- Full suite green; `npx tsc --noEmit` clean; `npx vite build` succeeds.
- Zero leaked `test_*` databases after a full run.
