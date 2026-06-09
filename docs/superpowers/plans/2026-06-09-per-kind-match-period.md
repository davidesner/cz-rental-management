# Per-Kind matchPeriod Derivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For each reconciliation kind, derive the payment-matching window from cost statement periods instead of always using the reconciliation period, allowing electricity billed on a Feb-Feb cycle to be matched and reconciled correctly within a Jan-Dec reconciliation.

**Architecture:** The pure `computeItemsWithBreakdown` function in `core/services/reconciliation.ts` gains a per-kind `matchPeriod` derivation step. For each kind, candidates are cost statements whose `periodFrom` falls within the reconciliation period; their union period becomes `matchPeriod` (or the recon period if none qualify). Payments and cost aggregation for that kind use `matchPeriod`. The derived `matchPeriod` and its source are surfaced on the API response and in the UI. No DB schema changes required — matchPeriod is computed on-the-fly.

**Tech Stack:** TypeScript, Vitest, Hono, React 18, TanStack Query, Tailwind CSS, pnpm

---

## File Map

| File | Change |
|---|---|
| `core/services/reconciliation.ts` | Per-kind matchPeriod derivation; filter payments per matchPeriod; extend `ReconciliationItemRow` and `ItemBreakdown` types |
| `tests/reconciliation-match-period.test.ts` | New test file: 4 new test cases for matchPeriod rule |
| `tests/property-slug-a-2024.test.ts` | Verify matchPeriod fields appear, result still +693 Kč ±1 Kč |
| `src/pages/ReconciliationDetail.tsx` | Add "Období" column; ⓘ tooltip for non-default matchPeriod; extend interfaces |
| `src/pages/ContractDetail.tsx` | `ComputeDialog` gets per-kind period preview section; extend interfaces; help text in `CostStatementDialog` |
| `src/pages/CostStatements.tsx` | Help text below period inputs in create dialog |
| `claude-plugin/templates/skill/SKILL.md` | New "Period matching pravidlo" section |
| `docs/superpowers/specs/2026-06-05-rental-management-design.md` | Update §5.3 and §5.4 with per-kind matchPeriod |

---

## Task 1: Extend types and add matchPeriod derivation helper

**Files:**
- Modify: `core/services/reconciliation.ts:11-41`

- [ ] **Step 1.1: Add matchPeriod fields to interfaces**

In `core/services/reconciliation.ts`, extend the `ItemBreakdown` interface and `ReconciliationItemRow` interface:

```ts
// Add to ItemBreakdown (after the existing fields):
export interface ItemBreakdown {
  costStatements: Array<{
    id: string;
    periodFrom: string;
    periodTo: string;
    totalAmount: number;
    adjustmentAmount: number;
    adjustmentNote: string | null;
    note: string | null;
    documentRef: string | null;
  }>;
  months: Array<{
    month: string;
    daysActive: number;
    daysInMonth: number;
    expectedThisKind: number;
    expectedTotal: number;
    receivedTotal: number;
    paidThisKind: number;
  }>;
  matchPeriod: { from: string; to: string };
  matchPeriodSource: 'default' | 'from-cost-statements';
  matchPeriodIsDifferentFromDefault: boolean;
}
```

And extend `ReconciliationItemRow` (no additional fields needed on the item level — the breakdown carries the info).

- [ ] **Step 1.2: Add `deriveMatchPeriod` helper function**

Add this pure function just before `computeItemsWithBreakdown` (around line 86):

```ts
/**
 * Derive matchPeriod for a given kind.
 *
 * Candidates: cost statements of this kind whose periodFrom STARTS within
 * [reconPeriodFrom, reconPeriodTo] (inclusive on both ends).
 *
 * If candidates found: matchPeriod = (min(cs.periodFrom), max(cs.periodTo))
 * Otherwise: matchPeriod = (reconPeriodFrom, reconPeriodTo)  [default]
 */
function deriveMatchPeriod(
  kind: string,
  reconPeriodFrom: string,
  reconPeriodTo: string,
  statements: Array<{ kind: string; periodFrom: string; periodTo: string }>,
): { from: string; to: string; source: 'default' | 'from-cost-statements' } {
  const candidates = statements.filter(
    s => s.kind === kind
      && s.periodFrom >= reconPeriodFrom
      && s.periodFrom <= reconPeriodTo
  );
  if (candidates.length === 0) {
    return { from: reconPeriodFrom, to: reconPeriodTo, source: 'default' };
  }
  const from = candidates.reduce((min, s) => s.periodFrom < min ? s.periodFrom : min, candidates[0]!.periodFrom);
  const to = candidates.reduce((max, s) => s.periodTo > max ? s.periodTo : max, candidates[0]!.periodTo);
  return { from, to, source: 'from-cost-statements' };
}
```

- [ ] **Step 1.3: Run TypeScript check**

```bash
cd /Users/esner/Projects/rental_management && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: No errors related to the new interface fields (may show errors from callers we haven't updated yet — that is fine at this stage).

---

## Task 2: Implement per-kind matchPeriod in computeItemsWithBreakdown

**Files:**
- Modify: `core/services/reconciliation.ts:105-258`

- [ ] **Step 2.1: Update computeItemsWithBreakdown signature and return type**

The function currently returns `Array<{ kind: Kind; actualCost: number; paid: number; difference: number; breakdown: ItemBreakdown }>`. The `breakdown.matchPeriod` field will now be populated per kind. No signature change is needed — `ItemBreakdown` already has the new fields after Task 1.

- [ ] **Step 2.2: Change payment filtering to per-kind matchPeriod**

Currently `buildItemsWithBreakdown` fetches payments filtered to `[periodFrom, periodTo]` at the DB level. The pure function `computeItemsWithBreakdown` then builds slots for the whole recon period. 

The key insight: **matchPeriod affects which months are in the FIFO window for a kind**. Instead of changing the DB query, we compute matchPeriod per kind and then, in the per-kind paid tally, only count `paidThisKind` from months that fall within that kind's matchPeriod.

Replace the section in `computeItemsWithBreakdown` that builds `paidPerKind` (lines ~146-212). The complete updated function body (replace the entire function from line 106 to 257):

```ts
function computeItemsWithBreakdown(
  contractRow: { id: string; startDate: string; endDate: string | null; paymentDueDay: number; paymentAppliesTo: string },
  periodFrom: string,
  periodTo: string,
  terms: Array<{ validFrom: string; validTo: string | null; baseRent: number; serviceAdvance: number }>,
  utilities: Array<{ kind: string; validFrom: string; validTo: string | null; monthlyAdvance: number }>,
  payments: Array<{ id: string; amount: number; paidAt: string }>,
  reductions: Array<{ forMonth: string; amount: number }>,
  statements: Array<{
    id: string;
    kind: string;
    periodFrom: string;
    periodTo: string;
    totalAmount: number;
    adjustmentAmount: number;
    adjustmentNote: string | null;
    note: string | null;
    documentRef: string | null;
  }>,
): Array<{ kind: Kind; actualCost: number; paid: number; difference: number; breakdown: ItemBreakdown }> {

  const paymentDueDay = contractRow.paymentDueDay;
  const paymentAppliesTo = contractRow.paymentAppliesTo as 'current' | 'next';

  // Build month slots for FIFO matching — always over full recon period
  const slots: MonthSlot[] = [];
  for (const { year, month } of eachMonthInPeriod(periodFrom, periodTo)) {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const monthFirst = `${monthStr}-01`;
    const exp = expectedForMonth(
      year, month,
      contractRow.startDate, contractRow.endDate,
      terms.map(t => ({ validFrom: t.validFrom, validTo: t.validTo, baseRent: t.baseRent, serviceAdvance: t.serviceAdvance })),
      utilities.map(u => ({ kind: u.kind as UtilityKind, validFrom: u.validFrom, validTo: u.validTo, monthlyAdvance: u.monthlyAdvance })),
    );
    const reduction = reductions.find(r => r.forMonth === monthFirst);
    const expectedTotal = exp.baseRent + exp.serviceAdvance + UTILITY_ORDER.reduce((s, k) => s + exp.utilities[k], 0);
    const rentReductionAmt = reduction?.amount ?? 0;
    const dueDate = computeDueDate(monthStr, paymentDueDay, paymentAppliesTo);
    slots.push({
      month: monthStr,
      expected: exp,
      effectiveExpected: expectedTotal - rentReductionAmt,
      rentReduction: rentReductionAmt,
      dueDate,
    });
  }

  // FIFO match over full recon period slots
  const offsetMonths = paymentAppliesTo === 'next' ? 1 : 0;
  const paymentRefs = payments.map(p => {
    const [yy, mm] = p.paidAt.split('-').map(Number) as [number, number, number];
    let nm = mm + offsetMonths;
    let ny = yy;
    if (nm > 12) { nm = nm - 12; ny += 1; }
    const naturalMonth = `${ny}-${String(nm).padStart(2, '0')}`;
    return { id: p.id, amount: p.amount, paidAt: p.paidAt, naturalMonth };
  });
  const { perMonth } = matchPayments(slots, paymentRefs);

  // monthsPerKind collects per-month data keyed by kind — always over full recon period
  const monthsPerKind: Record<Kind, ItemBreakdown['months']> = {
    rent: [], services: [], electricity: [], gas: [], internet: [], water: [], other: [],
  };

  let rentExpectedTotal = 0;

  for (const slot of slots) {
    const match = perMonth[slot.month]!;
    const received = match.receivedTotal;
    const exp = slot.expected;
    const rentEffective = Math.max(0, exp.baseRent - slot.rentReduction);
    const effectiveExp = { ...exp, baseRent: rentEffective };
    const a = allocate(received, effectiveExp);

    rentExpectedTotal += rentEffective;

    const expectedTotal = exp.baseRent + exp.serviceAdvance + UTILITY_ORDER.reduce((s, k) => s + exp.utilities[k], 0);

    monthsPerKind.rent.push({
      month: slot.month, daysActive: exp.daysActive, daysInMonth: exp.daysInMonth,
      expectedThisKind: rentEffective, expectedTotal, receivedTotal: received, paidThisKind: a.baseRentPaid,
    });
    monthsPerKind.services.push({
      month: slot.month, daysActive: exp.daysActive, daysInMonth: exp.daysInMonth,
      expectedThisKind: exp.serviceAdvance, expectedTotal, receivedTotal: received, paidThisKind: a.servicePaid,
    });
    for (const kind of UTILITY_ORDER) {
      monthsPerKind[kind].push({
        month: slot.month, daysActive: exp.daysActive, daysInMonth: exp.daysInMonth,
        expectedThisKind: exp.utilities[kind], expectedTotal, receivedTotal: received, paidThisKind: a.utilityPaid[kind],
      });
    }
  }

  // Group cost statements by kind — only include statements whose periodFrom starts within recon period
  const statementsPerKind: Record<Kind, ItemBreakdown['costStatements']> = {
    rent: [], services: [], electricity: [], gas: [], internet: [], water: [], other: [],
  };
  const costPerKind: Record<Kind, number> = {
    rent: rentExpectedTotal,
    services: 0, electricity: 0, gas: 0, internet: 0, water: 0, other: 0,
  };

  // Determine matchPeriod per kind (using all statements for derivation)
  const kindsToShow: Kind[] = ['rent', 'services', ...UTILITY_ORDER];

  // For cost aggregation: use statements that "qualify" for each kind
  // (cs.periodFrom within recon period — same filter used by deriveMatchPeriod)
  for (const s of statements) {
    const k = s.kind as Kind;
    // A statement is included if its periodFrom starts within the recon period
    if (s.periodFrom >= periodFrom && s.periodFrom <= periodTo) {
      statementsPerKind[k].push({
        id: s.id, periodFrom: s.periodFrom, periodTo: s.periodTo,
        totalAmount: s.totalAmount, adjustmentAmount: s.adjustmentAmount,
        adjustmentNote: s.adjustmentNote, note: s.note, documentRef: s.documentRef,
      });
      costPerKind[k] += s.totalAmount + s.adjustmentAmount;
    }
  }

  // Build result items
  const result: Array<{ kind: Kind; actualCost: number; paid: number; difference: number; breakdown: ItemBreakdown }> = [];
  for (const kind of kindsToShow) {
    // Derive matchPeriod for this kind
    const mp = deriveMatchPeriod(kind, periodFrom, periodTo, statements);
    const matchPeriodIsDifferentFromDefault = mp.source === 'from-cost-statements'
      && (mp.from !== periodFrom || mp.to !== periodTo);

    // For paid: sum paidThisKind only for months within matchPeriod
    const months = monthsPerKind[kind];
    const matchedMonths = months.filter(m => {
      // Month YYYY-MM is within matchPeriod if the month-start (YYYY-MM-01) <= matchPeriod.to
      // AND the month-end is >= matchPeriod.from. Use simple string comparison on YYYY-MM.
      const monthStart = `${m.month}-01`;
      // Last day of month: get YYYY-MM of the matchPeriod boundaries for comparison
      const mpFromMonth = mp.from.slice(0, 7);  // YYYY-MM
      const mpToMonth = mp.to.slice(0, 7);       // YYYY-MM
      return m.month >= mpFromMonth && m.month <= mpToMonth;
    });

    const paid = kind === 'rent'
      ? months.reduce((s, m) => s + m.paidThisKind, 0)  // rent always uses full recon period
      : matchedMonths.reduce((s, m) => s + m.paidThisKind, 0);

    const actual = costPerKind[kind];
    if (actual === 0 && paid === 0) continue;

    result.push({
      kind,
      actualCost: actual,
      paid,
      difference: paid - actual,
      breakdown: {
        costStatements: statementsPerKind[kind],
        months,
        matchPeriod: { from: mp.from, to: mp.to },
        matchPeriodSource: mp.source,
        matchPeriodIsDifferentFromDefault,
      },
    });
  }
  return result;
}
```

**Important note on backward compatibility:** The original code included cost statements that _overlapped_ the recon period (using `lte(periodFrom, periodTo) AND gte(periodTo, periodFrom)` in the DB query). The new rule changes cost statement inclusion to _periodFrom starts within recon period_. This is an intentional behavior change per the spec. The DB query in `buildItemsWithBreakdown` still fetches overlapping statements (needed to find the correct matchPeriod candidates), but cost aggregation now only counts statements whose `periodFrom >= reconPeriodFrom`.

- [ ] **Step 2.3: Run TypeScript check**

```bash
cd /Users/esner/Projects/rental_management && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: 0 errors.

---

## Task 3: Update existing tests to account for behavior change

**Files:**
- Modify: `tests/reconciliation-edge-cases.test.ts:540-566` (the "CostStatement crossing the period boundary" test)

- [ ] **Step 3.1: Update the boundary-crossing test**

The old code included a statement with `periodFrom: '2023-10-01'` in a recon period starting `2024-01-01`. Under the new rule, this statement is NOT included (its `periodFrom` is before `reconPeriodFrom`). Update the test to reflect the new correct behavior:

Find the test "CostStatement crossing the period boundary → IS included" (around line 540) and change it to test the **new** behavior: a statement whose `periodFrom` is before `reconPeriodFrom` is no longer included.

Replace the test body:

```ts
it('CostStatement whose periodFrom starts BEFORE reconciliation periodFrom → NOT included (new rule)', async () => {
  const { client, app, cookie, property, contract } = await bootstrap('costcross@b.cz', '2024-01-01');

  // Statement spans 2023-10 to 2024-03 — periodFrom is BEFORE our 2024-01-01 period
  // Under the new per-kind matchPeriod rule: periodFrom (2023-10-01) < reconPeriodFrom (2024-01-01)
  // → statement does NOT qualify as a candidate → NOT included in cost aggregation
  await app.request('/api/cost-statements', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      propertyId: property.id, kind: 'electricity',
      periodFrom: '2023-10-01', periodTo: '2024-03-31',
      totalAmount: 360000, adjustmentAmount: 0,
    }),
  });

  const res = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ periodFrom: '2024-01-01', periodTo: '2024-03-31' }),
  });
  expect(res.status).toBe(201);
  const rec = (await res.json() as any).reconciliation;

  const elecItem = rec.items.find((i: any) => i.kind === 'electricity');
  // Statement's periodFrom (2023-10-01) is before recon period (2024-01-01)
  // → not included → elecItem should be absent (no payments either)
  expect(elecItem).toBeUndefined();

  await client.close();
}, 30_000);
```

- [ ] **Step 3.2: Update the "CostStatement with periodTo BEFORE" test to verify breakdown.matchPeriod field exists**

After the main assertion in the "periodTo BEFORE" test (around line 510), add a check that verifies matchPeriod is present when an item IS returned:

The test already passes; just need to ensure it still passes. Run tests to verify before continuing.

- [ ] **Step 3.3: Run existing tests to measure baseline breakage**

```bash
cd /Users/esner/Projects/rental_management && pnpm test --run tests/reconciliation-edge-cases.test.ts 2>&1 | tail -30
```

Expected: Only the "crossing the period boundary" test changes behavior; that test was just updated. All others should still pass.

- [ ] **Step 3.4: Commit Task 1-3 together**

```bash
cd /Users/esner/Projects/rental_management && git add core/services/reconciliation.ts tests/reconciliation-edge-cases.test.ts && git commit -m "$(cat <<'EOF'
feat(reconciliation): derive matchPeriod per kind from cost statement periods

For each kind, matchPeriod = union of cost statement periods whose periodFrom
starts within the recon period. Payments for that kind are matched within
matchPeriod (not the whole recon period). Cost aggregation also only counts
statements starting within the recon period.

matchPeriod, matchPeriodSource, and matchPeriodIsDifferentFromDefault are
surfaced on ItemBreakdown.

Behavior change: cost statements whose periodFrom precedes the recon period
are no longer included (previously included if they overlapped). Updated test.
EOF
)"
```

---

## Task 4: New tests for the matchPeriod rule

**Files:**
- Create: `tests/reconciliation-match-period.test.ts`

- [ ] **Step 4.1: Write the failing tests first**

Create `tests/reconciliation-match-period.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';

async function bootstrap(email = 'a@b.cz', contractStart = '2024-01-01') {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, email, 'password123', 'A');
  const p = (await (await app.request('/api/properties', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'KP' }),
  })).json() as any).property;
  const t = (await (await app.request('/api/tenants', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'SB' }),
  })).json() as any).tenant;
  const ct = (await (await app.request('/api/contracts', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: contractStart }),
  })).json() as any).contract;
  await app.request(`/api/contracts/${ct.id}/terms`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ validFrom: contractStart, baseRent: 3300000, serviceAdvance: 700000, source: 'initial' }),
  });
  await app.request(`/api/contracts/${ct.id}/utilities`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ kind: 'electricity', validFrom: contractStart, monthlyAdvance: 120000 }),
  });
  return { client, app, cookie, property: p, contract: ct };
}

describe('per-kind matchPeriod derivation', () => {
  it('matchPeriod for rent = default (no cost statement for rent kind)', async () => {
    const { client, app, cookie, contract } = await bootstrap('mp-rent@b.cz', '2024-01-01');

    const res = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-01-01', periodTo: '2024-12-31' }),
    });
    expect(res.status).toBe(201);
    const rec = (await res.json() as any).reconciliation;
    const rentItem = rec.items.find((i: any) => i.kind === 'rent');
    expect(rentItem).toBeDefined();
    expect(rentItem.breakdown.matchPeriod).toEqual({ from: '2024-01-01', to: '2024-12-31' });
    expect(rentItem.breakdown.matchPeriodSource).toBe('default');
    expect(rentItem.breakdown.matchPeriodIsDifferentFromDefault).toBe(false);

    await client.close();
  }, 30_000);

  it('electricity statement with Feb-Feb period in Jan-Dec recon → matchPeriod = Feb-Feb, payments matched Feb-Feb', async () => {
    // Contract Jan 2024; electricity utility 120 Kč/month.
    // Electricity cost statement period: 2024-02-15 to 2025-02-14 (billing cycle).
    // Payments: one in Feb 2024 for full month. Recon: 2024-01-01 to 2024-12-31.
    //
    // Expected: matchPeriod for electricity = 2024-02-15 to 2025-02-14 (from statement).
    // Paid for electricity = sum of paidThisKind for months 2024-02 to 2024-12 only.
    const { client, app, cookie, property, contract } = await bootstrap('mp-feb@b.cz', '2024-01-01');

    // Add electricity cost statement with Feb-Feb period
    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2024-02-15', periodTo: '2025-02-14',
        totalAmount: 1500000, adjustmentAmount: 0,
      }),
    });

    // Add 12 monthly payments (full months, Jan-Dec 2024)
    for (let m = 1; m <= 12; m++) {
      const month = String(m).padStart(2, '0');
      await app.request('/api/payments/batch', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify([{
          amount: 4120000, paidAt: `2024-${month}-10`, source: 'bank',
          externalId: `mp-feb-${month}`, contractId: contract.id, counterparty: 'TENANT',
        }]),
      });
    }

    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-01-01', periodTo: '2024-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;

    const elecItem = rec.items.find((i: any) => i.kind === 'electricity');
    expect(elecItem).toBeDefined();
    // matchPeriod derived from statement
    expect(elecItem.breakdown.matchPeriod).toEqual({ from: '2024-02-15', to: '2025-02-14' });
    expect(elecItem.breakdown.matchPeriodSource).toBe('from-cost-statements');
    expect(elecItem.breakdown.matchPeriodIsDifferentFromDefault).toBe(true);

    // Paid should cover months 2024-02 through 2024-12 (11 months), NOT 2024-01
    // paidThisKind per month ~ 120000 per full month
    const paidMonths = elecItem.breakdown.months.filter((m: any) => m.paidThisKind > 0);
    const janMonth = elecItem.breakdown.months.find((m: any) => m.month === '2024-01');
    // Jan is in recon period but outside matchPeriod (matchPeriod starts Feb-15)
    // month 2024-01 is before mpFromMonth 2024-02 → excluded from paid sum
    expect(janMonth).toBeDefined(); // month record still exists in breakdown
    // The paid for elec item should NOT include Jan
    const paidExcludingJan = elecItem.breakdown.months
      .filter((m: any) => m.month !== '2024-01')
      .reduce((s: number, m: any) => s + m.paidThisKind, 0);
    expect(elecItem.paid).toBe(paidExcludingJan);

    await client.close();
  }, 30_000);

  it('12 monthly statements (Jan-Dec) → matchPeriod = union = Jan-Dec (same as default, source=from-cost-statements)', async () => {
    // 12 monthly cost statements each starting in their respective month → all have periodFrom within recon period.
    // Union: min(Jan-01) to max(Dec-31) = 2024-01-01 to 2024-12-31.
    // matchPeriodIsDifferentFromDefault = false because union equals recon period.
    const { client, app, cookie, property, contract } = await bootstrap('mp-monthly@b.cz', '2024-01-01');

    for (let m = 1; m <= 12; m++) {
      const month = String(m).padStart(2, '0');
      const lastDay = new Date(2024, m, 0).getDate();
      await app.request('/api/cost-statements', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          propertyId: property.id, kind: 'electricity',
          periodFrom: `2024-${month}-01`, periodTo: `2024-${month}-${lastDay}`,
          totalAmount: 100000, adjustmentAmount: 0,
        }),
      });
    }

    // Add one payment to make item appear
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([{
        amount: 4120000, paidAt: '2024-06-10', source: 'bank',
        externalId: 'mp-monthly-june', contractId: contract.id, counterparty: 'TENANT',
      }]),
    });

    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-01-01', periodTo: '2024-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;

    const elecItem = rec.items.find((i: any) => i.kind === 'electricity');
    expect(elecItem).toBeDefined();
    expect(elecItem.breakdown.matchPeriod).toEqual({ from: '2024-01-01', to: '2024-12-31' });
    expect(elecItem.breakdown.matchPeriodSource).toBe('from-cost-statements');
    // Union equals the default period → isDifferentFromDefault = false
    expect(elecItem.breakdown.matchPeriodIsDifferentFromDefault).toBe(false);
    // actualCost = 12 × 100000 = 1200000
    expect(elecItem.actualCost).toBe(1200000);

    await client.close();
  }, 30_000);

  it('cost statement starting Dec 2023 (before 2024-01-01 recon) → NOT included, matchPeriod = default', async () => {
    // Statement: periodFrom 2023-12-01, periodTo 2024-01-31
    // Recon: 2024-01-01 to 2024-12-31
    // periodFrom (2023-12-01) < reconPeriodFrom (2024-01-01) → does NOT qualify as candidate
    // → matchPeriod = default, actualCost = 0
    const { client, app, cookie, property, contract } = await bootstrap('mp-crossyear@b.cz', '2024-01-01');

    await app.request('/api/cost-statements', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        propertyId: property.id, kind: 'electricity',
        periodFrom: '2023-12-01', periodTo: '2024-01-31',
        totalAmount: 200000, adjustmentAmount: 0,
      }),
    });

    // Add payment to trigger item appearing
    await app.request('/api/payments/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify([{
        amount: 4120000, paidAt: '2024-01-10', source: 'bank',
        externalId: 'mp-cross-jan', contractId: contract.id, counterparty: 'TENANT',
      }]),
    });

    const comp = await app.request(`/api/contracts/${contract.id}/reconciliations/compute`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ periodFrom: '2024-01-01', periodTo: '2024-12-31' }),
    });
    expect(comp.status).toBe(201);
    const rec = (await comp.json() as any).reconciliation;

    const elecItem = rec.items.find((i: any) => i.kind === 'electricity');
    expect(elecItem).toBeDefined();
    // Statement's periodFrom is before reconPeriodFrom → not included
    expect(elecItem.breakdown.costStatements).toHaveLength(0);
    expect(elecItem.actualCost).toBe(0);
    // matchPeriod = default (no qualifying statements)
    expect(elecItem.breakdown.matchPeriod).toEqual({ from: '2024-01-01', to: '2024-12-31' });
    expect(elecItem.breakdown.matchPeriodSource).toBe('default');
    expect(elecItem.breakdown.matchPeriodIsDifferentFromDefault).toBe(false);

    await client.close();
  }, 30_000);
});
```

- [ ] **Step 4.2: Run the new tests to verify they pass**

```bash
cd /Users/esner/Projects/rental_management && pnpm test --run tests/reconciliation-match-period.test.ts 2>&1 | tail -30
```

Expected: All 4 tests pass.

- [ ] **Step 4.3: Run the <property-name-a> 2024 reference test to verify no regression**

```bash
cd /Users/esner/Projects/rental_management && pnpm test --run tests/property-slug-a-2024.test.ts 2>&1 | tail -20
```

Expected: Test passes, total diff within [69200, 69400] (±1 Kč from +693 Kč). The <property-name-a> test uses cost statements with `periodFrom: '2024-09-20'` and recon period also starts `2024-09-20`, so statements qualify as candidates and matchPeriod = their period = recon period → behavior unchanged.

- [ ] **Step 4.4: Run all reconciliation tests**

```bash
cd /Users/esner/Projects/rental_management && pnpm test --run tests/reconciliation.test.ts tests/reconciliation-edge-cases.test.ts tests/reconciliation-match-period.test.ts tests/property-slug-a-2024.test.ts 2>&1 | tail -20
```

Expected: All pass.

- [ ] **Step 4.5: Commit**

```bash
cd /Users/esner/Projects/rental_management && git add tests/reconciliation-match-period.test.ts && git commit -m "$(cat <<'EOF'
test(reconciliation): add per-kind matchPeriod rule tests

4 new tests covering:
- rent always uses default matchPeriod (no cost statements for rent kind)
- electricity Feb-Feb statement in Jan-Dec recon → matchPeriod Feb-Feb, Jan excluded from paid
- 12 monthly statements → union equals default, matchPeriodIsDifferentFromDefault=false
- cost statement starting before recon period → not included, matchPeriod defaults
EOF
)"
```

---

## Task 5: ReconciliationDetail UI — "Období" column and tooltip

**Files:**
- Modify: `src/pages/ReconciliationDetail.tsx`

- [ ] **Step 5.1: Extend ReconciliationDetail interfaces**

In `src/pages/ReconciliationDetail.tsx`, add `matchPeriod` fields to the `ItemBreakdown` interface (around line 31):

```ts
interface ItemBreakdown {
  costStatements: CostStatementEntry[];
  months: MonthEntry[];
  matchPeriod?: { from: string; to: string };
  matchPeriodSource?: 'default' | 'from-cost-statements';
  matchPeriodIsDifferentFromDefault?: boolean;
}
```

- [ ] **Step 5.2: Add "Období" column header to the items table**

In `ReconciliationDetailPage` (around line 333), update the `TableHeader`:

```tsx
<TableHeader>
  <TableRow>
    <TableHead>Druh</TableHead>
    <TableHead>Období</TableHead>
    <TableHead className="text-right">Zaplaceno</TableHead>
    <TableHead className="text-right">Předepsáno / Náklady</TableHead>
    <TableHead className="text-right">Rozdíl</TableHead>
  </TableRow>
</TableHeader>
```

And update `TableFooter` colSpan from 3 to 4:

```tsx
<TableCell colSpan={4} className="font-medium">
  Celkový rozdíl {isStale && <span className="text-xs text-muted-foreground">(persistovaný)</span>}
</TableCell>
```

And the live stale row too:

```tsx
<TableCell colSpan={4} className="font-medium text-blue-700">
  Celkový rozdíl (aktuální, fresh z podkladů)
</TableCell>
```

- [ ] **Step 5.3: Update ReconciliationItemRow component to show matchPeriod**

In the `ReconciliationItemRow` component (around line 173), the `TableRow` currently has 4 cells. Add a second cell for "Období" between the kind and the paid columns:

Replace the entire `ReconciliationItemRow` component:

```tsx
function ReconciliationItemRow({
  item,
  live,
}: {
  item: ReconciliationItem;
  live: { actualCost: number; paid: number; difference: number } | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const mp = item.breakdown?.matchPeriod;
  const mpSource = item.breakdown?.matchPeriodSource;
  const mpDiffers = item.breakdown?.matchPeriodIsDifferentFromDefault ?? false;

  const periodLabel = mp
    ? `${mp.from} – ${mp.to}`
    : '—';

  const sourceLabel = mpSource === 'from-cost-statements'
    ? '(ze statementu)'
    : '(default)';

  const tooltipText = mpDiffers && mp
    ? `Matching období je odvozeno z cost statementu (${mp.from} až ${mp.to}). Pokud existuje cost statement daného druhu jehož periodFrom startuje uvnitř reconciliation období, jeho period (sjednocený přes víc statementů) určuje matching okno pro platby. Jinak default = reconciliation období.`
    : '';

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(e => !e)}
      >
        <TableCell>
          <div className="flex items-center gap-1">
            {expanded
              ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            }
            {item.kind}
            {live && (
              <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                změna
              </span>
            )}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1 text-sm">
            <span className={mpDiffers ? 'text-amber-700 font-medium' : 'text-muted-foreground'}>
              {periodLabel}
            </span>
            <span className="text-xs text-muted-foreground">{sourceLabel}</span>
            {mpDiffers && tooltipText && (
              <div className="relative inline-block">
                <button
                  className="text-blue-500 hover:text-blue-700 text-xs leading-none"
                  onMouseEnter={() => setTooltipVisible(true)}
                  onMouseLeave={() => setTooltipVisible(false)}
                  onClick={e => e.stopPropagation()}
                  aria-label="Informace o matching období"
                >
                  ⓘ
                </button>
                {tooltipVisible && (
                  <div className="absolute z-50 left-0 top-5 w-72 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md">
                    {tooltipText}
                  </div>
                )}
              </div>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div>{fmtKc(item.paid)}</div>
          {live && <div className="text-xs text-blue-700">{fmtKc(live.paid)} (aktuální)</div>}
        </TableCell>
        <TableCell className="text-right">
          <div>{fmtKc(item.actualCost)}</div>
          {live && <div className="text-xs text-blue-700">{fmtKc(live.actualCost)} (aktuální)</div>}
        </TableCell>
        <TableCell className={`text-right font-medium ${item.difference < 0 ? 'text-destructive' : 'text-green-600'}`}>
          <div>{fmtKc(item.difference)}</div>
          {live && (
            <div className={`text-xs ${live.difference < 0 ? 'text-destructive' : 'text-blue-700'}`}>
              {fmtKc(live.difference)} (aktuální)
            </div>
          )}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="p-0">
            <ItemBreakdownPanel breakdown={item.breakdown} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
```

Also update `ReconciliationItem` interface to include optional breakdown with matchPeriod:

```ts
interface ReconciliationItem {
  kind: string;
  paid: number;
  actualCost: number;
  difference: number;
  breakdown?: ItemBreakdown;
}
```

- [ ] **Step 5.4: Update empty-items row to span 5 columns**

In the table body where there are no items:

```tsx
<TableCell colSpan={5} className="text-center text-muted-foreground py-6">Žádné položky.</TableCell>
```

- [ ] **Step 5.5: Run TypeScript check**

```bash
cd /Users/esner/Projects/rental_management && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 5.6: Commit**

```bash
cd /Users/esner/Projects/rental_management && git add src/pages/ReconciliationDetail.tsx && git commit -m "$(cat <<'EOF'
feat(ui): show matchPeriod per kind in reconciliation detail

Add Období column to the items table showing the derived matching period
for each kind. For non-default matchPeriods (e.g. electricity billed Feb-Feb),
show amber text and an (i) tooltip explaining the derivation rule.
EOF
)"
```

---

## Task 6: ContractDetail — ComputeDialog per-kind period preview

**Files:**
- Modify: `src/pages/ContractDetail.tsx:590-637` (ComputeDialog)

- [ ] **Step 6.1: Add CostStatement interface extension for matchPeriod preview**

At the top of `ContractDetail.tsx`, the `CostStatement` interface already has `periodFrom`/`periodTo`/`kind`. No change needed there.

Add a helper type for the preview computation (add near the helpers section ~line 151):

```ts
type Kind = 'rent' | 'services' | 'electricity' | 'gas' | 'internet' | 'water' | 'other';
const KINDS_TO_SHOW: Kind[] = ['rent', 'services', 'electricity', 'gas', 'internet', 'water', 'other'];

function deriveMatchPeriodClient(
  kind: Kind,
  reconFrom: string,
  reconTo: string,
  statements: CostStatement[],
): { from: string; to: string; source: 'default' | 'from-cost-statements'; count: number } {
  const candidates = statements.filter(
    s => s.kind === kind
      && s.periodFrom >= reconFrom
      && s.periodFrom <= reconTo
  );
  if (candidates.length === 0) {
    return { from: reconFrom, to: reconTo, source: 'default', count: 0 };
  }
  const from = candidates.reduce((min, s) => s.periodFrom < min ? s.periodFrom : min, candidates[0]!.periodFrom);
  const to = candidates.reduce((max, s) => s.periodTo > max ? s.periodTo : max, candidates[0]!.periodTo);
  return { from, to, source: 'from-cost-statements', count: candidates.length };
}
```

- [ ] **Step 6.2: Update ComputeDialog to include per-kind preview**

Replace the entire `ComputeDialog` component (lines 598-637):

```tsx
function ComputeDialog({ contractId, onClose, onCreated }: ComputeDialogProps) {
  const [form, setForm] = useState({ periodFrom: '', periodTo: '' });
  const [err, setErr] = useState<string | null>(null);

  // Fetch cost statements for this contract's property to compute preview
  const contractQuery = useQuery({
    queryKey: ['contracts', contractId],
    queryFn: () => api.get<{ contract: Contract }>(`/api/contracts/${contractId}`),
  });
  const propertyId = contractQuery.data?.contract?.propertyId;

  const statementsQuery = useQuery({
    queryKey: ['cost-statements-for-preview', propertyId],
    queryFn: () => api.get<{ statements: CostStatement[] }>(`/api/cost-statements?propertyId=${propertyId}`),
    enabled: !!propertyId,
  });
  const allStatements = statementsQuery.data?.statements ?? [];

  // Compute per-kind preview when both period fields are filled
  const preview: Array<{ kind: Kind; from: string; to: string; source: 'default' | 'from-cost-statements'; count: number; differs: boolean }> | null =
    form.periodFrom && form.periodTo
      ? KINDS_TO_SHOW
          .map(kind => {
            const mp = deriveMatchPeriodClient(kind, form.periodFrom, form.periodTo, allStatements);
            const differs = mp.source === 'from-cost-statements'
              && (mp.from !== form.periodFrom || mp.to !== form.periodTo);
            return { kind, ...mp, differs };
          })
          .filter(p => p.source === 'from-cost-statements' || p.kind === 'rent' || allStatements.some(s => s.kind === p.kind))
      : null;

  const computeMutation = useMutation({
    mutationFn: () =>
      api.post<{ reconciliation: Reconciliation }>(
        `/api/contracts/${contractId}/reconciliations/compute`,
        { periodFrom: form.periodFrom, periodTo: form.periodTo }
      ),
    onSuccess: (result) => { onCreated(result.reconciliation.id); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-semibold">Spočítat vyúčtování nájemníkovi</h2>
        <div>
          <Label>Období od</Label>
          <Input type="date" value={form.periodFrom} onChange={e => setForm({ ...form, periodFrom: e.target.value })} />
        </div>
        <div>
          <Label>Období do</Label>
          <Input type="date" value={form.periodTo} onChange={e => setForm({ ...form, periodTo: e.target.value })} />
        </div>

        {preview && preview.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-sm font-semibold">Per-kind period preview</p>
            <p className="text-xs text-muted-foreground">
              Reconciliace {form.periodFrom} → {form.periodTo}
            </p>
            <div className="space-y-1">
              {preview.map(p => (
                <div key={p.kind} className="flex items-center gap-2 text-xs">
                  <span className="w-20 font-medium text-muted-foreground">{p.kind}</span>
                  <span className={`font-mono ${p.differs ? 'text-amber-700 font-semibold' : 'text-foreground'}`}>
                    {p.from} → {p.to}
                  </span>
                  <span className="text-muted-foreground">
                    {p.source === 'from-cost-statements'
                      ? `(z ${p.count} statement${p.count === 1 ? 'u' : 'ů'})`
                      : '(default, žádný cost statement)'}
                  </span>
                  {p.differs && (
                    <span className="text-amber-600 font-semibold">⚠ liší se od defaultu</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Zrušit</Button>
          <Button
            onClick={() => computeMutation.mutate()}
            disabled={!form.periodFrom || !form.periodTo || computeMutation.isPending}
          >
            Spočítat
          </Button>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6.3: Add help text to CostStatementDialog (in ContractDetail)**

In the `CostStatementDialog` component (around line 435), add help text below the period inputs. After the `</div>` closing the period section (around line 459), add:

```tsx
<p className="text-xs text-muted-foreground mt-1 leading-snug">
  <strong>Tip:</strong> <code>periodFrom</code>/<code>periodTo</code> určují co náklad pokrývá. Při reconciliaci se tento period použije i pro <strong>matching plateb</strong> tohoto druhu — pokud <code>periodFrom</code> startuje uvnitř reconciliation období. Pro proporcionální rozdělení přes year boundary vytvoř dva statementy, každý ve svém kalendářním roce.
</p>
```

- [ ] **Step 6.4: Run TypeScript check**

```bash
cd /Users/esner/Projects/rental_management && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 6.5: Commit**

```bash
cd /Users/esner/Projects/rental_management && git add src/pages/ContractDetail.tsx && git commit -m "$(cat <<'EOF'
feat(ui): per-kind period preview in compute dialog + help text on cost statement dialog

ComputeDialog now shows a per-kind period preview before submit, derived client-side
from existing cost statements for the property. Kinds with a non-default matchPeriod
are flagged with a warning. CostStatementDialog gains help text explaining that
periodFrom/To also drives payment matching in reconciliation.
EOF
)"
```

---

## Task 7: CostStatements.tsx — help text below period inputs

**Files:**
- Modify: `src/pages/CostStatements.tsx:326-355` (period input section of the create dialog)

- [ ] **Step 7.1: Add help text after the period inputs**

In the create dialog within `CostStatements.tsx`, the period section ends around line 355 (after the `</div>` closing the custom period grid). Add the same help text as in Task 6 step 6.3, right after the outer period `</div>` (around line 354):

```tsx
<p className="text-xs text-muted-foreground mt-1 leading-snug">
  <strong>Tip:</strong> <code>periodFrom</code>/<code>periodTo</code> určují co náklad pokrývá. Při reconciliaci se tento period použije i pro <strong>matching plateb</strong> tohoto druhu — pokud <code>periodFrom</code> startuje uvnitř reconciliation období. Pro proporcionální rozdělení přes year boundary vytvoř dva statementy, každý ve svém kalendářním roce.
</p>
```

- [ ] **Step 7.2: Run TypeScript check**

```bash
cd /Users/esner/Projects/rental_management && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors.

- [ ] **Step 7.3: Commit**

```bash
cd /Users/esner/Projects/rental_management && git add src/pages/CostStatements.tsx && git commit -m "$(cat <<'EOF'
feat(ui): help text on cost statement period field explaining matchPeriod impact
EOF
)"
```

---

## Task 8: SKILL.md — Period matching section

**Files:**
- Modify: `claude-plugin/templates/skill/SKILL.md`

- [ ] **Step 8.1: Add "Period matching pravidlo" section**

In `/Users/esner/Projects/rental_management/claude-plugin/templates/skill/SKILL.md`, add the new section after "## Workflow ročního vyúčtování" (around line 68) and before "## Self-update":

```markdown
## Period matching pravidlo

Reconciliation matchuje platby a náklady per kind podle pravidla:

1. Pro každý kind najdi cost statementy, jejichž `periodFrom` startuje uvnitř reconciliation období (`reconFrom <= cs.periodFrom <= reconTo`)
2. `matchPeriod` pro kind = union jejich period (`min(periodFrom)` → `max(periodTo)`)
3. Pokud žádný cost statement nesplňuje → matchPeriod = reconciliation period (default)
4. Pro rent (žádný cost statement existuje) → matchPeriod = vždy default

Tato logika umožňuje různé cykly per kind (např. SVJ kalendářní rok + elektřina Feb-Feb).

### Prevence problémů

**Pokud cost statement crossuje year boundary** (např. PRE Feb 2024 - Feb 2025), můžeš zvolit:

- (a) **Nechat tak** — statement startuje v jednom roce (2024), automaticky patří k tomu recon (2024). MatchPeriod pro elektřinu = Feb-Feb. Platby matchovány v té periodě. Druhý rok (2025) recon nedostane žádný statement co tam nepatří, použije default.

- (b) **Proporcionální split na 2 statementy** — pokud chceš strict kalendářní rok matching, rozděl jeden cycle statement na dva:
  - Statement A: 2024-02-15 → 2024-12-31 (cost = `total × (321/366)`)
  - Statement B: 2025-01-01 → 2025-02-14 (cost = `total × (45/366)`)
  - Adjustmenty rozděl analogicky
  - Každý belongs k svému kalendářnímu roku reconciliace
  - **Pro klientskou stranu lepší pokud chceš predictable calendar-year matching**

Volba mezi (a) a (b) je per-property metodika — doporuč user vybrat jednu a držet se jí.

### Ukaž user period preview

Před `compute_reconciliation` volej `cost_statements_list` pro property a předznám user co se bude dít:

```
"Pro tuto reconciliaci vidím:
 • SVJ: 1 statement period 2024-01-01 → 2024-12-31
 • Elektřina: 1 statement period 2024-02-15 → 2025-02-14
 → Matching pro elektřinu bude Feb 2024 - Feb 2025 (cycle)
 OK?"
```
```

- [ ] **Step 8.2: Verify the file looks correct**

```bash
grep -n "Period matching\|matchPeriod\|Self-update" /Users/esner/Projects/rental_management/claude-plugin/templates/skill/SKILL.md
```

Expected: Lines for "## Period matching pravidlo", "matchPeriod", and "## Self-update" (in that order).

- [ ] **Step 8.3: Commit**

```bash
cd /Users/esner/Projects/rental_management && git add claude-plugin/templates/skill/SKILL.md && git commit -m "$(cat <<'EOF'
docs(skill): add Period matching pravidlo section with proportional split prevention

Documents the per-kind matchPeriod derivation rule, how year-boundary statements
are handled (option a: leave as-is vs option b: proportional split), and instructs
the skill to preview matchPeriod before calling compute_reconciliation.
EOF
)"
```

---

## Task 9: Spec update — §5.3 and §5.4

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-rental-management-design.md:188-208`

- [ ] **Step 9.1: Update §5.3 and §5.4**

The current §5.3 (line 188) describes `actualCost` as a simple sum. Replace §5.3 and §5.4 to reflect per-kind matchPeriod derivation:

Find and replace the block from `### 5.3` to end of `### 5.4` (lines 188-208) with:

```markdown
### 5.3 Reálné náklady (per kind v období)
```
actualCost(property, kind, reconFrom, reconTo):
  -- Najdi cost statementy, jejichž periodFrom startuje v [reconFrom, reconTo]
  -- (= matchPeriod candidates pro tento kind)
  candidates = CostStatement where property=p, kind=k,
               periodFrom >= reconFrom AND periodFrom <= reconTo
  return Σ (cs.totalAmount + cs.adjustmentAmount) over candidates
```

Cost statementy, jejichž periodFrom leží PŘED reconFrom, se nezapočítají
(přísluší předchozímu recon období). Pokud periodFrom leží uvnitř recon
ale periodTo přesahuje za reconTo (např. Feb 2024 – Feb 2025 v Jan-Dec recon),
celá jejich hodnota se započítá do tohoto reconciliation.

#### 5.3.1 Per-kind matchPeriod derivation
```
deriveMatchPeriod(kind, reconFrom, reconTo, allStatements):
  candidates = statementy kde kind=kind AND periodFrom in [reconFrom, reconTo]
  if candidates is empty:
    return (reconFrom, reconTo)  -- default
  else:
    return (min(cs.periodFrom), max(cs.periodTo))  -- union z candidates
```

`matchPeriod` se používá pro:
1. **Payment matching** — pro daný kind se sčítá paidThisKind jen z měsíců
   v matchPeriod okně (ne z celého recon období)
2. **Transparency** — matchPeriod, matchPeriodSource, matchPeriodIsDifferentFromDefault
   jsou součástí `ItemBreakdown` v API response

### 5.4 Vyúčtování (compute)
```
compute(contract, reconFrom, reconTo):
  slots = eachMonthInPeriod(reconFrom, reconTo)
  FIFO-match all payments to slots (over full recon period)
  for each kind in distinct(contract utilities ∪ "services"):
    mp = deriveMatchPeriod(kind, reconFrom, reconTo, costStatements)
    paid = Σ allocate(contract, month).{servicePaid|utilityPaid[kind]}
           over months in mp window
    actual = actualCost(property, kind, reconFrom, reconTo)  -- §5.3
    diff = paid - actual
    append ReconciliationItem(kind, actual, paid, diff,
           breakdown.matchPeriod=mp, breakdown.matchPeriodSource=...)
  return Reconciliation with items
```

Rent vždy používá celé recon období pro paid (žádný cost statement pro rent kind).
```

- [ ] **Step 9.2: Commit**

```bash
cd /Users/esner/Projects/rental_management && git add docs/superpowers/specs/2026-06-05-rental-management-design.md && git commit -m "$(cat <<'EOF'
docs(spec): update §5.3/§5.4 with per-kind matchPeriod derivation rule
EOF
)"
```

---

## Task 10: Full build, all tests, marketplace sync

**Files:**
- Run: `pnpm build`
- Run: `pnpm test --run`
- Run: `cp -R` marketplace sync

- [ ] **Step 10.1: Full test suite**

```bash
cd /Users/esner/Projects/rental_management && pnpm test --run 2>&1 | tail -20
```

Expected: All tests pass. Test count is higher than before (4 new tests in `reconciliation-match-period.test.ts`; 1 test in `reconciliation-edge-cases.test.ts` changed description). The <property-name-a> 2024 test still shows +693 Kč ±1 Kč.

- [ ] **Step 10.2: Build**

```bash
cd /Users/esner/Projects/rental_management && pnpm build 2>&1 | tail -20
```

Expected: Build exits 0. No TypeScript or bundle errors.

- [ ] **Step 10.3: Marketplace sync**

```bash
cp -R /Users/esner/Projects/rental_management/claude-plugin/. /Users/esner/LOCAL_PLUGINS/rental-management-plugin/
```

Expected: Command exits 0.

- [ ] **Step 10.4: Verify sync**

```bash
grep -n "Period matching" /Users/esner/LOCAL_PLUGINS/rental-management-plugin/templates/skill/SKILL.md | head -5
```

Expected: Line with "## Period matching pravidlo" found.

---

## Self-Review Checklist

**Spec coverage:**

| Requirement | Covered in |
|---|---|
| Per-kind matchPeriod derivation rule | Task 1-2 |
| matchPeriod from cost statement candidates (periodFrom in recon period) | Task 2 |
| matchPeriod default when no candidates | Task 2 + Task 4 (test) |
| matchPeriod used for payment matching | Task 2 |
| matchPeriodSource, matchPeriodIsDifferentFromDefault on response | Task 1 |
| New test: electricity Feb-Feb in Jan-Dec recon | Task 4 |
| New test: 12 monthly statements → union = default | Task 4 |
| New test: year-boundary statement not included | Task 4 |
| <property-name-a> 2024 still +693 Kč ±1 Kč | Task 4 step 4.3 |
| UI: Období column in ReconciliationDetail | Task 5 |
| UI: ⓘ tooltip for non-default matchPeriod | Task 5 |
| UI: per-kind preview in ComputeDialog | Task 6 |
| UI: help text in CostStatementDialog (ContractDetail) | Task 6 |
| UI: help text in CostStatements.tsx create dialog | Task 7 |
| SKILL.md: Period matching pravidlo section | Task 8 |
| Spec §5.3/§5.4 update | Task 9 |
| Marketplace sync | Task 10 |

**Placeholder scan:** No TBD/TODO/placeholder in any task. All code blocks are complete.

**Type consistency:**
- `ItemBreakdown.matchPeriod: { from: string; to: string }` — used consistently as `mp.from`/`mp.to` in all tasks
- `matchPeriodSource: 'default' | 'from-cost-statements'` — same string literals in backend and frontend interfaces
- `matchPeriodIsDifferentFromDefault: boolean` — same name in backend `computeItemsWithBreakdown`, frontend `ReconciliationDetail`, and `ContractDetail` preview
- `deriveMatchPeriod` (backend) and `deriveMatchPeriodClient` (frontend) — distinct names, same logic, intentionally duplicated for zero-dependency client compute
- `KINDS_TO_SHOW` in `ContractDetail` — matches `kindsToShow` in backend; rent is included (shows default)

**Edge case: cost statement overlap filter change**

The original DB query in `buildItemsWithBreakdown` uses `lte(periodFrom, periodTo) AND gte(periodTo, periodFrom)` — this fetches all overlapping statements (including those starting before the recon period). The DB query is preserved unchanged (we need it to find matchPeriod candidates). The change is in `computeItemsWithBreakdown` where cost aggregation now only counts statements with `periodFrom >= reconPeriodFrom`. The test "CostStatement crossing the period boundary → IS included" was changed in Task 3 to reflect this new behavior.
