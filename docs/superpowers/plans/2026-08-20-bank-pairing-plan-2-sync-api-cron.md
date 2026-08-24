# Bank Payment Pairing — Plan 2: Sync Engine, API and Cron

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the pure libraries from Plan 1 into a working end-to-end sync: fetch KB notifications over IMAP, stage them, pair them to contracts, expose the whole surface over REST and MCP, and run it on a Vercel cron.

**Architecture:** `core/services/bank-sync.ts` orchestrates, taking the IMAP fetcher as an **injected function** so every test runs offline against a fake. `core/lib/imap-fetcher.ts` is the only file that opens a socket. Routes are thin shells over services, exactly like `server/routes/rent-reductions.ts`. One route — the cron endpoint — is registered before the auth middleware and is the single place in the codebase where `orgId` does not come from `ctx`.

**Tech Stack:** TypeScript (ESM), Hono, Drizzle ORM, Vitest, `imapflow`, fastmcp, Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-08-20-bank-payment-pairing-design.md`
**Depends on:** Plan 1 (all five tasks complete and committed)

## Global Constraints

- **Money is integer haléře.** Never `parseFloat` an amount.
- **`orgId` always comes from `ctx`** — except `GET /api/cron/bank-sync`, which is documented, comment-marked and test-pinned as the one exception.
- **Bank integrations and the transaction inbox are owner-only** (`ctx.role === 'owner'`). The per-contract rule follows normal `allowedPropertyIds` property access.
- **The IMAP password is write-only.** No API response may ever contain `imapPasswordEnc` or the plaintext. Responses carry `imapPasswordSet: boolean`.
- **`MAX_MESSAGES_PER_RUN = 25`.** A run that hits the cap saves its cursor and makes progress; it never silently drops the remainder.
- **The IMAP mailbox is opened read-only.** Never mark seen, move, or delete.
- **Never fetch `sourceLink`.** It is a click-tracker.
- **ESM import specifiers end in `.js`.**
- **New env vars:** `SECRET_ENCRYPTION_KEY` (32 bytes, base64), `CRON_SECRET`.
- **Tests:** `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" pnpm test`
- **Work on `feat/bank-payment-pairing`.** `main` is protected.

---

### Task 6: `imap-fetcher` — the only file that opens a socket

**Files:**
- Create: `core/lib/imap-fetcher.ts`
- Test: `tests/imap-cursor.test.ts`
- Modify: `package.json` — add `imapflow`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface ImapConfig { host: string; port: number; user: string; password: string; folder: string }`
  - `interface ImapCursor { uidValidity: number | null; lastUid: number | null }`
  - `interface RawMessage { uid: number; source: Buffer }`
  - `interface FetchOpts { limit: number; sinceFallback: Date | null; deadline: number }`
  - `type FetchMessages = (cfg: ImapConfig, cursor: ImapCursor, opts: FetchOpts) => Promise<{ messages: RawMessage[]; cursor: ImapCursor; matchedCount: number }>`
  - `nextSearchRange(cursor, serverUidValidity, sinceFallback): { kind: 'uid'; range: string } | { kind: 'since'; since: Date }`
  - `fetchMessagesOverImap: FetchMessages` (the real implementation)
  - `probeConnection(cfg: ImapConfig): Promise<{ ok: true; mailboxExists: number } | { ok: false; error: string }>`

- [ ] **Step 1: Add the dependency**

```bash
pnpm add imapflow
```

- [ ] **Step 2: Write the failing test**

Only the cursor arithmetic is unit-tested — it is the part with logic. The socket path is covered by the `test-connection` endpoint in Task 8 and was already validated by the deployment probe recorded in the spec.

Create `tests/imap-cursor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextSearchRange } from '../core/lib/imap-fetcher.js';

const FALLBACK = new Date('2026-08-01T00:00:00Z');

describe('nextSearchRange', () => {
  it('falls back to a date search on the very first run', () => {
    expect(nextSearchRange({ uidValidity: null, lastUid: null }, 111, FALLBACK))
      .toEqual({ kind: 'since', since: FALLBACK });
    });

  it('continues from lastUid+1 when uidValidity still matches', () => {
    expect(nextSearchRange({ uidValidity: 111, lastUid: 42 }, 111, FALLBACK))
      .toEqual({ kind: 'uid', range: '43:*' });
  });

  // UIDs are only meaningful within one uidValidity generation. If the server
  // rebuilt the mailbox, continuing from the old UID would silently skip
  // everything — so we re-derive from a date instead. Idempotency on messageId
  // makes the resulting overlap harmless.
  it('rebuilds from a date search when uidValidity changed', () => {
    expect(nextSearchRange({ uidValidity: 111, lastUid: 42 }, 222, FALLBACK))
      .toEqual({ kind: 'since', since: FALLBACK });
  });

  it('uses the epoch when there is no fallback date to work from', () => {
    const res = nextSearchRange({ uidValidity: null, lastUid: null }, 111, null);
    expect(res.kind).toBe('since');
    if (res.kind !== 'since') return;
    expect(res.since.getTime()).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/imap-cursor.test.ts`
Expected: FAIL — `Cannot find module '../core/lib/imap-fetcher.js'`

- [ ] **Step 4: Write the implementation**

Create `core/lib/imap-fetcher.ts`:

```ts
// The ONLY file in this feature that opens a network socket.
//
// Everything else depends on the FetchMessages type rather than on this
// implementation, so the sync service is tested against an in-memory fake and
// CI never touches a mailbox.
//
// Verified working from a Vercel function (fra1, TLSv1.3, ~38 ms to Gmail) —
// see the risk register in the design spec.
import { ImapFlow } from 'imapflow';

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  folder: string;
}

/** IMAP incremental cursor. UIDs are only unique within one uidValidity generation. */
export interface ImapCursor {
  uidValidity: number | null;
  lastUid: number | null;
}

export interface RawMessage {
  uid: number;
  source: Buffer;
}

export interface FetchOpts {
  limit: number;
  /** Used when there is no usable UID cursor. */
  sinceFallback: Date | null;
  /** Epoch ms after which we stop fetching and commit what we have. */
  deadline: number;
}

export type FetchMessages = (
  cfg: ImapConfig,
  cursor: ImapCursor,
  opts: FetchOpts,
) => Promise<{ messages: RawMessage[]; cursor: ImapCursor; matchedCount: number }>;

export type SearchRange =
  | { kind: 'uid'; range: string }
  | { kind: 'since'; since: Date };

export function nextSearchRange(
  cursor: ImapCursor,
  serverUidValidity: number,
  sinceFallback: Date | null,
): SearchRange {
  const usable = cursor.uidValidity !== null
    && cursor.lastUid !== null
    && cursor.uidValidity === serverUidValidity;
  if (usable) return { kind: 'uid', range: `${cursor.lastUid! + 1}:*` };
  return { kind: 'since', since: sinceFallback ?? new Date(0) };
}

function clientFor(cfg: ImapConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.password },
    // imapflow logs verbosely at info level by default; a serverless log stream
    // is not the place for per-command IMAP chatter.
    logger: false,
  });
}

export const fetchMessagesOverImap: FetchMessages = async (cfg, cursor, opts) => {
  const client = clientFor(cfg);
  await client.connect();
  try {
    // readOnly: we never mark seen, move, or delete. The UID cursor is what
    // makes the sync incremental, so mutating the mailbox buys nothing and
    // would be visible in the user's own inbox.
    const mailbox = await client.mailboxOpen(cfg.folder, { readOnly: true });
    const uidValidity = Number(mailbox.uidValidity);
    const range = nextSearchRange(cursor, uidValidity, opts.sinceFallback);

    const found = range.kind === 'uid'
      ? await client.search({ uid: range.range }, { uid: true })
      : await client.search({ since: range.since }, { uid: true });

    // imapflow's search() resolves `false` — not null/undefined — when nothing
    // matches, so `?? []` would pass `false` straight through and throw on
    // .slice(). Array.isArray is the only guard that covers it.
    const all = (Array.isArray(found) ? found : []).slice().sort((a, b) => a - b);
    // Oldest first, capped. The cursor advances only over what we actually
    // processed, so a capped run resumes rather than skips.
    const selected = all.slice(0, opts.limit);

    const messages: RawMessage[] = [];
    for (const uid of selected) {
      if (Date.now() > opts.deadline) break;
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      messages.push({ uid, source: msg.source });
    }

    const highest = messages.length > 0 ? messages[messages.length - 1]!.uid : cursor.lastUid;
    return {
      messages,
      cursor: { uidValidity, lastUid: highest },
      matchedCount: all.length,
    };
  } finally {
    // logout() can throw on a half-closed socket; the fetch already succeeded
    // by then and failing the run over a noisy goodbye would be wrong.
    await client.logout().catch(() => undefined);
  }
};

/** Verify credentials and report how many messages the cursor-less search sees. */
export async function probeConnection(
  cfg: ImapConfig,
): Promise<{ ok: true; mailboxExists: number } | { ok: false; error: string }> {
  const client = clientFor(cfg);
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen(cfg.folder, { readOnly: true });
    return { ok: true, mailboxExists: Number(mailbox.exists) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await client.logout().catch(() => undefined);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/imap-cursor.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm build
git add core/lib/imap-fetcher.ts tests/imap-cursor.test.ts package.json pnpm-lock.yaml
git commit -m "feat(core): IMAP fetcher with a UID-based incremental cursor

Isolated behind the FetchMessages type so the sync service is tested against an
in-memory fake and CI opens no socket. Mailbox is opened read-only — the UID
cursor makes the sync incremental, so mutating the user's own inbox buys
nothing. UIDs are scoped to a uidValidity generation, so a mailbox rebuild
falls back to a date search rather than silently skipping everything."
```

---

### Task 7: `bank-sync` — orchestration, staging and the duplicate guard

The core of the feature.

**Files:**
- Create: `core/services/bank-sync.ts`
- Test: `tests/bank-sync.test.ts`
- Create: `tests/helpers/fake-imap.ts`

**Interfaces:**
- Consumes: `parseKbPaymentNotification`, `parseFromTokens` (Task 3); `matchTransaction`, `MatchingRule` (Task 4); `open` (Task 1); `FetchMessages`, `ImapConfig`, `ImapCursor` (Task 6); `accountsEqual` (Task 2).
- Produces:
  - `const MAX_MESSAGES_PER_RUN = 25`
  - `interface DescribableTransaction { messageForRecipient: string | null; vs: string | null; ks: string | null; ss: string | null }`
  - `buildDescription(tx: DescribableTransaction): string | null`
  - `interface SyncDeps { fetchMessages: FetchMessages; key: Buffer; now?: () => Date; budgetMs?: number }`
  - `interface SyncResult { runId: string; integrationId: string; fetched: number; created: number; matched: number; failed: number; status: 'ok' | 'error'; error: string | null }`
  - `loadCandidateRules(db: DB, orgId: string): Promise<MatchingRule[]>`
  - `findDuplicate(db: DB, orgId: string, fp: Fingerprint): Promise<string | null>` where `Fingerprint = { messageId: string; amount: number; valueDate: string; fromAccount: string | null; toAccount: string | null; vs: string | null; ks: string | null; ss: string | null }`
  - `syncIntegration(db: DB, integrationId: string, deps: SyncDeps, trigger: 'cron' | 'manual'): Promise<SyncResult>`
  - `syncAllActiveIntegrations(db: DB, deps: SyncDeps): Promise<SyncResult[]>`

- [ ] **Step 1: Write the fake fetcher helper**

Create `tests/helpers/fake-imap.ts`:

```ts
import type { FetchMessages, RawMessage } from '../../core/lib/imap-fetcher.js';

/**
 * In-memory FetchMessages. Records the config it was called with so tests can
 * assert the decrypted password reached the fetcher.
 */
export function fakeImap(messages: Array<{ uid: number; source: Buffer | string }>) {
  const calls: Array<{ password: string; user: string; folder: string }> = [];
  const fetchMessages: FetchMessages = async (cfg, cursor, opts) => {
    calls.push({ password: cfg.password, user: cfg.user, folder: cfg.folder });
    const after = cursor.lastUid ?? 0;
    const selected: RawMessage[] = messages
      .filter((m) => m.uid > after)
      .sort((a, b) => a.uid - b.uid)
      .slice(0, opts.limit)
      .map((m) => ({ uid: m.uid, source: Buffer.isBuffer(m.source) ? m.source : Buffer.from(m.source, 'utf8') }));
    const lastUid = selected.length > 0 ? selected[selected.length - 1]!.uid : cursor.lastUid;
    return { messages: selected, cursor: { uidValidity: 1, lastUid }, matchedCount: messages.length };
  };
  return { fetchMessages, calls };
}

export function failingImap(message: string) {
  const fetchMessages: FetchMessages = async () => { throw new Error(message); };
  return { fetchMessages };
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/bank-sync.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { freshDb, type DB } from './helpers/db.js';
import { fakeImap, failingImap } from './helpers/fake-imap.js';
import { loadFixtureHtml, makeEml, setFieldValue } from './helpers/kb-email.js';
import { seal } from '../core/lib/crypto-box.js';
import { syncIntegration, syncAllActiveIntegrations } from '../core/services/bank-sync.js';
import {
  organization, property, tenant, contract, payment,
  bankIntegration, bankTransaction, paymentMatchingRule, bankSyncRun,
} from '../core/db/schema.js';

const KEY = randomBytes(32);
const PASSWORD = 'app-password-1234';

// The fixture's own accounts, set by scripts/sanitize-kb-fixture.py
const FROM_ACCOUNT = '123-1234567890/0100';
const TO_ACCOUNT = '321-9876543210/0100';

interface Ctx { db: DB; close: () => Promise<void>; orgId: string; contractId: string; integrationId: string }

async function setup(opts: { accountNumber?: string | null } = {}): Promise<Ctx> {
  const { db, client } = await freshDb();
  const orgId = createId();
  await db.insert(organization).values({ id: orgId, name: 'O' });
  const propertyId = createId();
  await db.insert(property).values({ id: propertyId, orgId, name: 'P' });
  const tenantId = createId();
  await db.insert(tenant).values({ id: tenantId, orgId, name: 'T' });
  const contractId = createId();
  await db.insert(contract).values({ id: contractId, orgId, propertyId, tenantId, startDate: '2024-09-01' });
  const integrationId = createId();
  await db.insert(bankIntegration).values({
    id: integrationId, orgId, kind: 'kb_email', name: 'KB',
    imapHost: 'imap.example.com', imapUser: 'u@example.com',
    imapPasswordEnc: seal(PASSWORD, KEY),
    accountNumber: opts.accountNumber === undefined ? TO_ACCOUNT : opts.accountNumber,
  });
  return { db, close: client.close, orgId, contractId, integrationId };
}

async function addRule(db: DB, orgId: string, contractId: string, o: Record<string, unknown> = {}) {
  await db.insert(paymentMatchingRule).values({
    id: createId(), orgId, contractId,
    counterpartyAccount: FROM_ACCOUNT, amountFrom: 2000, amountTo: 4000,
    ...o,
  });
}

/** A KB notification with a distinct Message-ID. Amount is 30,00 Kč = 3000 haléře. */
async function notification(messageId: string, mutate?: (html: string) => string): Promise<Buffer> {
  let html = await loadFixtureHtml();
  if (mutate) html = mutate(html);
  return makeEml(html, { messageId: `<${messageId}>` });
}

const deps = (messages: Array<{ uid: number; source: Buffer }>) => ({
  ...fakeImap(messages), key: KEY,
});

describe('bank-sync', () => {
  it('imports a notification and pairs it to the matching contract', async () => {
    const c = await setup();
    await addRule(c.db, c.orgId, c.contractId);
    const d = deps([{ uid: 10, source: await notification('m1') }]);

    const result = await syncIntegration(c.db, c.integrationId, d, 'manual');

    expect(result.status).toBe('ok');
    expect(result.fetched).toBe(1);
    expect(result.created).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.failed).toBe(0);

    // The decrypted password reached the fetcher
    expect(d.calls[0]!.password).toBe(PASSWORD);

    const [tx] = await c.db.select().from(bankTransaction);
    expect(tx!.status).toBe('matched');
    expect(tx!.matchedBy).toBe('rule');
    expect(tx!.amount).toBe(3000);
    expect(tx!.currency).toBe('CZK');
    expect(tx!.valueDate).toBe('2026-08-20');
    expect(tx!.fromAccount).toBe(FROM_ACCOUNT);
    expect(tx!.messageId).toBe('m1');
    expect(tx!.rawTokens!.length).toBeGreaterThan(10);
    expect(tx!.paymentId).not.toBeNull();

    const [p] = await c.db.select().from(payment);
    expect(p!.contractId).toBe(c.contractId);
    expect(p!.amount).toBe(3000);
    expect(p!.paidAt).toBe('2026-08-20');
    expect(p!.source).toBe('bank');
    expect(p!.externalId).toBe('kbemail:m1');
    expect(p!.counterpartyAccount).toBe(FROM_ACCOUNT);
    expect(p!.counterparty).toBeNull(); // KB sends no payer name

    // The integration is healthy and the cursor advanced
    const [integ] = await c.db.select().from(bankIntegration).where(eq(bankIntegration.id, c.integrationId));
    expect(integ!.lastSyncStatus).toBe('ok');
    expect(integ!.lastSyncError).toBeNull();
    expect(integ!.lastUid).toBe(10);
    expect(integ!.lastSyncAt).not.toBeNull();
    await c.close();
  });

  it('is idempotent — a second run over the same message creates nothing', async () => {
    const c = await setup();
    await addRule(c.db, c.orgId, c.contractId);
    const msg = { uid: 10, source: await notification('m1') };

    await syncIntegration(c.db, c.integrationId, deps([msg]), 'manual');
    // Offer the SAME Message-ID again at a HIGHER uid. This matters: fakeImap
    // honours the cursor, so re-offering uid 10 would be withheld by the fake and
    // the test would pass without the (orgId, messageId) dedupe existing at all.
    // A higher uid gets past the cursor, so the only thing that can stop a second
    // payment is the dedupe this test is named after.
    const second = await syncIntegration(c.db, c.integrationId,
      { ...fakeImap([{ uid: 11, source: await notification('m1') }]), key: KEY }, 'cron');

    expect(second.created).toBe(0);
    expect(await c.db.select().from(bankTransaction)).toHaveLength(1);
    expect(await c.db.select().from(payment)).toHaveLength(1);
    await c.close();
  });

  it('leaves an unmatched transaction in the inbox with no payment', async () => {
    const c = await setup();
    // No rule at all
    const result = await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');

    expect(result.matched).toBe(0);
    const [tx] = await c.db.select().from(bankTransaction);
    expect(tx!.status).toBe('unmatched');
    expect(tx!.paymentId).toBeNull();
    expect(await c.db.select().from(payment)).toHaveLength(0);
    await c.close();
  });

  it('records ambiguity and creates no payment when two contracts match', async () => {
    const c = await setup();
    await addRule(c.db, c.orgId, c.contractId);
    // A second contract on the same property with an identically wide rule
    const otherContract = createId();
    const [prop] = await c.db.select().from(property);
    const [ten] = await c.db.select().from(tenant);
    await c.db.insert(contract).values({
      id: otherContract, orgId: c.orgId, propertyId: prop!.id, tenantId: ten!.id, startDate: '2024-09-01',
    });
    await addRule(c.db, c.orgId, otherContract);

    await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');

    const [tx] = await c.db.select().from(bankTransaction);
    expect(tx!.status).toBe('ambiguous');
    expect(tx!.paymentId).toBeNull();
    expect(tx!.statusReason).toContain(c.contractId);
    expect(tx!.statusReason).toContain(otherContract);
    expect(await c.db.select().from(payment)).toHaveLength(0);
    await c.close();
  });

  it('ignores a notification addressed to a different account of ours', async () => {
    const c = await setup({ accountNumber: '555-5555555555/0800' });
    await addRule(c.db, c.orgId, c.contractId);

    await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');

    const [tx] = await c.db.select().from(bankTransaction);
    expect(tx!.status).toBe('ignored');
    expect(tx!.statusReason).toBe('foreign_account');
    expect(await c.db.select().from(payment)).toHaveLength(0);
    await c.close();
  });

  it('ignores a non-CZK notification', async () => {
    const c = await setup();
    await addRule(c.db, c.orgId, c.contractId);
    const eur = await notification('m1', (html) => html
      .replace(/30,00(&nbsp;| )Kč/, '30,00$1EUR')
      .replace('30.00 CZK', '30.00 EUR'));

    await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: eur }]), 'manual');

    const [tx] = await c.db.select().from(bankTransaction);
    expect(tx!.status).toBe('ignored');
    expect(tx!.statusReason).toBe('unsupported_currency');
    expect(await c.db.select().from(payment)).toHaveLength(0);
    await c.close();
  });

  describe('the resend guard', () => {
    it('holds a re-sent notification as suspected_duplicate and creates no second payment', async () => {
      const c = await setup();
      await addRule(c.db, c.orgId, c.contractId);
      await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');

      // Same money, different Message-ID — KB re-sent the notification.
      const resend = { uid: 11, source: await notification('m2') };
      const result = await syncIntegration(c.db, c.integrationId, { ...fakeImap([resend]), key: KEY }, 'cron');

      expect(result.created).toBe(1);   // the record exists...
      expect(result.matched).toBe(0);   // ...but no payment was made
      expect(await c.db.select().from(payment)).toHaveLength(1);

      const dup = (await c.db.select().from(bankTransaction).where(eq(bankTransaction.messageId, 'm2')))[0];
      expect(dup!.status).toBe('suspected_duplicate');
      expect(dup!.paymentId).toBeNull();
      const original = (await c.db.select().from(bankTransaction).where(eq(bankTransaction.messageId, 'm1')))[0];
      expect(dup!.duplicateOfTransactionId).toBe(original!.id);
      await c.close();
    });

    it('does not flag a different amount as a duplicate', async () => {
      const c = await setup();
      await addRule(c.db, c.orgId, c.contractId, { amountFrom: 1000, amountTo: 5000 });
      await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');

      const other = await notification('m2', (html) => html
        .replace(/30,00(&nbsp;| )Kč/, '31,00$1Kč')
        .replace('30.00 CZK', '31.00 CZK'));
      await syncIntegration(c.db, c.integrationId, { ...fakeImap([{ uid: 11, source: other }]), key: KEY }, 'cron');

      const tx = (await c.db.select().from(bankTransaction).where(eq(bankTransaction.messageId, 'm2')))[0];
      expect(tx!.status).toBe('matched');
      expect(await c.db.select().from(payment)).toHaveLength(2);
      await c.close();
    });

    it('does not flag a duplicate of a transaction that produced no payment', async () => {
      const c = await setup();
      // No rule → first import is unmatched, paymentId null
      await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'manual');
      await syncIntegration(c.db, c.integrationId, { ...fakeImap([{ uid: 11, source: await notification('m2') }]), key: KEY }, 'cron');

      const tx = (await c.db.select().from(bankTransaction).where(eq(bankTransaction.messageId, 'm2')))[0];
      expect(tx!.status).toBe('unmatched');
      await c.close();
    });
  });

  describe('failure handling', () => {
    it('stores a structurally-drifted message and escalates the integration to error', async () => {
      const c = await setup();
      const drifted = await notification('m1', (html) => html.replace('Variabilní symbol', 'Neznámé pole'));

      const result = await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: drifted }]), 'cron');

      expect(result.failed).toBe(1);
      expect(result.status).toBe('error');
      const [tx] = await c.db.select().from(bankTransaction);
      expect(tx!.status).toBe('parse_failed');
      expect(tx!.statusReason).toContain('Variabilní symbol');
      expect(tx!.rawTokens!.length).toBeGreaterThan(5);

      const [integ] = await c.db.select().from(bankIntegration).where(eq(bankIntegration.id, c.integrationId));
      expect(integ!.lastSyncStatus).toBe('error');
      expect(integ!.lastSyncError).toBeTruthy();
      // The cursor still advanced — one bad message must not wedge the
      // integration forever.
      expect(integ!.lastUid).toBe(10);
      await c.close();
    });

    it('skips an unrelated e-mail WITHOUT escalating to error', async () => {
      const c = await setup();
      const unrelated = makeEml('<html><body><p>Newsletter</p></body></html>', {
        from: 'news@example.com', messageId: '<m9>',
      });

      const result = await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: unrelated }]), 'cron');

      expect(result.status).toBe('ok');
      expect(result.failed).toBe(0);
      expect(result.created).toBe(0);
      // Nothing stored — a stray message in the mailbox is not our business.
      expect(await c.db.select().from(bankTransaction)).toHaveLength(0);
      const [integ] = await c.db.select().from(bankIntegration).where(eq(bankIntegration.id, c.integrationId));
      expect(integ!.lastSyncStatus).toBe('ok');
      await c.close();
    });

    it('records a connection failure on the integration and the run', async () => {
      const c = await setup();
      const result = await syncIntegration(c.db, c.integrationId, { ...failingImap('AUTHENTICATIONFAILED'), key: KEY }, 'cron');

      expect(result.status).toBe('error');
      expect(result.error).toContain('AUTHENTICATIONFAILED');
      const [integ] = await c.db.select().from(bankIntegration).where(eq(bankIntegration.id, c.integrationId));
      expect(integ!.lastSyncStatus).toBe('error');
      expect(integ!.lastSyncError).toContain('AUTHENTICATIONFAILED');
      const [run] = await c.db.select().from(bankSyncRun);
      expect(run!.status).toBe('error');
      expect(run!.finishedAt).not.toBeNull();
      await c.close();
    });

    it('fails the run loudly when the encryption key is wrong', async () => {
      const c = await setup();
      const result = await syncIntegration(c.db, c.integrationId, { ...fakeImap([]), key: randomBytes(32) }, 'cron');
      expect(result.status).toBe('error');
      expect(result.error).toMatch(/SECRET_ENCRYPTION_KEY|decrypt/i);
      await c.close();
    });
  });

  it('writes a sync run row with counters for every attempt', async () => {
    const c = await setup();
    await addRule(c.db, c.orgId, c.contractId);
    await syncIntegration(c.db, c.integrationId, deps([{ uid: 10, source: await notification('m1') }]), 'cron');

    const [run] = await c.db.select().from(bankSyncRun);
    expect(run!.trigger).toBe('cron');
    expect(run!.status).toBe('ok');
    expect(run!.fetched).toBe(1);
    expect(run!.created).toBe(1);
    expect(run!.matched).toBe(1);
    expect(run!.finishedAt).not.toBeNull();
    await c.close();
  });

  describe('syncAllActiveIntegrations', () => {
    it('runs every active integration and skips inactive ones', async () => {
      const c = await setup();
      const inactive = createId();
      await c.db.insert(bankIntegration).values({
        id: inactive, orgId: c.orgId, kind: 'kb_email', name: 'Off',
        imapHost: 'h', imapUser: 'u', imapPasswordEnc: seal(PASSWORD, KEY), active: false,
      });

      const results = await syncAllActiveIntegrations(c.db, deps([{ uid: 10, source: await notification('m1') }]));

      expect(results).toHaveLength(1);
      expect(results[0]!.integrationId).toBe(c.integrationId);
      await c.close();
    });

    it('one failing integration does not stop the others', async () => {
      const c = await setup();
      const broken = createId();
      await c.db.insert(bankIntegration).values({
        id: broken, orgId: c.orgId, kind: 'kb_email', name: 'Broken',
        imapHost: 'h', imapUser: 'u', imapPasswordEnc: 'v1:garbage:garbage:garbage',
      });

      const results = await syncAllActiveIntegrations(c.db, deps([]));

      expect(results).toHaveLength(2);
      expect(results.filter(r => r.status === 'error')).toHaveLength(1);
      expect(results.filter(r => r.status === 'ok')).toHaveLength(1);
      await c.close();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/bank-sync.test.ts`
Expected: FAIL — `Cannot find module '../core/services/bank-sync.js'`

- [ ] **Step 4: Write the implementation**

Create `core/services/bank-sync.ts`:

```ts
import { createId } from '@paralleldrive/cuid2';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  bankIntegration, bankSyncRun, bankTransaction, contract, payment, paymentMatchingRule,
} from '../db/schema.js';
import { open } from '../lib/crypto-box.js';
import { accountsEqual } from '../lib/account-number.js';
import { parseKbPaymentNotification, type ParsedNotification } from '../lib/kb-email-parser.js';
import { matchTransaction, type MatchingRule } from '../lib/payment-pairing.js';
import type { FetchMessages, ImapConfig, ImapCursor } from '../lib/imap-fetcher.js';

/** Bounded so a run always fits the serverless budget and always makes progress. */
export const MAX_MESSAGES_PER_RUN = 25;

/** Wall-clock allowance for one integration, leaving headroom under maxDuration=60s. */
const DEFAULT_BUDGET_MS = 45_000;

/** How far back a cursor-less run looks. */
const FIRST_RUN_LOOKBACK_DAYS = 90;

export interface SyncDeps {
  fetchMessages: FetchMessages;
  key: Buffer;
  now?: () => Date;
  budgetMs?: number;
}

export interface SyncResult {
  runId: string;
  integrationId: string;
  fetched: number;
  created: number;
  matched: number;
  failed: number;
  status: 'ok' | 'error';
  error: string | null;
}

export interface Fingerprint {
  messageId: string;
  amount: number;
  valueDate: string;
  fromAccount: string | null;
  toAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
}

/**
 * Every rule in the org, with its contract's validity window joined in so the
 * matcher can stay a pure function.
 */
export async function loadCandidateRules(db: DB, orgId: string): Promise<MatchingRule[]> {
  const rows = await db
    .select({
      contractId: paymentMatchingRule.contractId,
      counterpartyAccount: paymentMatchingRule.counterpartyAccount,
      vs: paymentMatchingRule.vs,
      ks: paymentMatchingRule.ks,
      ss: paymentMatchingRule.ss,
      amountFrom: paymentMatchingRule.amountFrom,
      amountTo: paymentMatchingRule.amountTo,
      active: paymentMatchingRule.active,
      contractStartDate: contract.startDate,
      contractEndDate: contract.endDate,
    })
    .from(paymentMatchingRule)
    .innerJoin(contract, eq(contract.id, paymentMatchingRule.contractId))
    .where(and(eq(paymentMatchingRule.orgId, orgId), eq(contract.orgId, orgId)));
  return rows;
}

/**
 * The resend guard. KB gives us no transaction id, so `Message-ID` uniqueness
 * only stops the SAME e-mail being imported twice — not a notification KB
 * re-sends for money already collected. Look for an earlier transaction with an
 * identical fingerprint that actually produced a payment.
 */
export async function findDuplicate(db: DB, orgId: string, fp: Fingerprint): Promise<string | null> {
  const conds = [
    eq(bankTransaction.orgId, orgId),
    ne(bankTransaction.messageId, fp.messageId),
    // Only a transaction that produced a payment can be double-counted.
    isNotNull(bankTransaction.paymentId),
    eq(bankTransaction.amount, fp.amount),
    eq(bankTransaction.valueDate, fp.valueDate),
  ];
  const candidates = await db.select({
    id: bankTransaction.id,
    fromAccount: bankTransaction.fromAccount,
    toAccount: bankTransaction.toAccount,
    vs: bankTransaction.vs,
    ks: bankTransaction.ks,
    ss: bankTransaction.ss,
  }).from(bankTransaction).where(and(...conds));

  // Amount + date narrow it in SQL; the nullable text columns are compared here
  // so NULL === NULL counts as equal, which SQL's `=` would not.
  const same = candidates.find((r) =>
    r.fromAccount === fp.fromAccount
    && r.toAccount === fp.toAccount
    && r.vs === fp.vs && r.ks === fp.ks && r.ss === fp.ss);
  return same?.id ?? null;
}

interface Outcome {
  status: 'matched' | 'unmatched' | 'ambiguous' | 'suspected_duplicate' | 'ignored';
  statusReason: string | null;
  contractId: string | null;
  duplicateOf: string | null;
}

async function decide(
  db: DB, orgId: string, integrationAccount: string | null,
  parsed: ParsedNotification, rules: MatchingRule[],
): Promise<Outcome> {
  const none = { contractId: null, duplicateOf: null };

  // Policy, deliberately here rather than in the parser: a EUR notification
  // parses perfectly, we just do not act on it.
  if (parsed.currency !== 'CZK') {
    return { status: 'ignored', statusReason: 'unsupported_currency', ...none };
  }
  // Guards against harvesting notifications for another of the user's accounts
  // that happens to share the mailbox.
  if (integrationAccount !== null && !accountsEqual(integrationAccount, parsed.toAccount)) {
    return { status: 'ignored', statusReason: 'foreign_account', ...none };
  }

  const match = matchTransaction(
    {
      amount: parsed.amount, valueDate: parsed.valueDate, fromAccount: parsed.fromAccount,
      vs: parsed.vs, ks: parsed.ks, ss: parsed.ss,
    },
    rules,
  );
  if (match.kind === 'none') return { status: 'unmatched', statusReason: null, ...none };
  if (match.kind === 'many') {
    return { status: 'ambiguous', statusReason: `candidates: ${match.contractIds.join(', ')}`, ...none };
  }

  const duplicateOf = await findDuplicate(db, orgId, {
    messageId: parsed.messageId, amount: parsed.amount, valueDate: parsed.valueDate,
    fromAccount: parsed.fromAccount, toAccount: parsed.toAccount,
    vs: parsed.vs, ks: parsed.ks, ss: parsed.ss,
  });
  if (duplicateOf !== null) {
    // Held, not discarded: two genuinely identical transfers on one day are
    // possible, and dropping one would silently lose a tenant's money. The user
    // confirms it from the inbox, which creates the payment as a manual assign.
    return { status: 'suspected_duplicate', statusReason: 'shodná platba už je spárovaná', contractId: null, duplicateOf };
  }
  return { status: 'matched', statusReason: null, contractId: match.contractId, duplicateOf: null };
}

/**
 * Structural parameter rather than ParsedNotification: the manual-assign path in
 * bank-transaction.ts calls this with a DB row, which has these four fields but
 * not the rest. Casting a partial object at that call site would be a real type
 * hazard for no benefit.
 */
export interface DescribableTransaction {
  messageForRecipient: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
}

export function buildDescription(tx: DescribableTransaction): string | null {
  if (tx.messageForRecipient) return tx.messageForRecipient;
  const parts = [
    tx.vs ? `VS ${tx.vs}` : null,
    tx.ks ? `KS ${tx.ks}` : null,
    tx.ss ? `SS ${tx.ss}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export async function syncIntegration(
  db: DB, integrationId: string, deps: SyncDeps, trigger: 'cron' | 'manual',
): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const runId = createId();
  const [integ] = await db.select().from(bankIntegration).where(eq(bankIntegration.id, integrationId));
  if (!integ) throw new Error(`bank integration ${integrationId} not found`);

  await db.insert(bankSyncRun).values({ id: runId, integrationId, trigger, status: 'ok', startedAt: now() });

  let fetched = 0, created = 0, matched = 0, failed = 0;
  let error: string | null = null;

  try {
    // A bad key must fail the run with a distinct, recognisable message rather
    // than surface as a mysterious auth error against the mail server.
    let password: string;
    try {
      password = open(integ.imapPasswordEnc, deps.key);
    } catch (e) {
      throw new Error(`cannot decrypt IMAP password — check SECRET_ENCRYPTION_KEY (${e instanceof Error ? e.message : String(e)})`);
    }

    const cfg: ImapConfig = {
      host: integ.imapHost, port: integ.imapPort, user: integ.imapUser,
      password, folder: integ.imapFolder,
    };
    const cursor: ImapCursor = { uidValidity: integ.uidValidity, lastUid: integ.lastUid };
    const lookback = new Date(now().getTime() - FIRST_RUN_LOOKBACK_DAYS * 86_400_000);

    const { messages, cursor: nextCursor } = await deps.fetchMessages(cfg, cursor, {
      limit: MAX_MESSAGES_PER_RUN,
      sinceFallback: integ.lastSyncAt ?? lookback,
      deadline: now().getTime() + (deps.budgetMs ?? DEFAULT_BUDGET_MS),
    });
    fetched = messages.length;

    const rules = await loadCandidateRules(db, integ.orgId);

    for (const msg of messages) {
      const parseResult = await parseKbPaymentNotification(msg.source, {
        fromFilter: integ.fromFilter, subjectFilter: integ.subjectFilter,
      });

      if (!parseResult.ok) {
        // A stray newsletter is not a failure — storing it would fill the inbox
        // with noise, and escalating the integration to `error` over it would
        // cry wolf. Anything else IS a failure worth seeing.
        if (parseResult.reason === 'not_kb_notification') continue;

        failed += 1;
        error = `${parseResult.reason}: ${parseResult.detail}`;
        // A genuine KB notification (it passed both the sender and subject
        // filters) whose Message-ID header is missing or unparseable MUST still
        // be persisted. Skipping the insert would leave it neither stored nor
        // ever re-offered — the cursor advances below regardless — which is
        // precisely the silent loss the parse_failed row exists to prevent.
        // messageId is NOT NULL and uniquely indexed, so fall back to a
        // synthetic key from the mailbox generation and uid, which identifies
        // the same message stably within a uidValidity generation.
        const failedMessageId = parseResult.messageId
          ?? `imap:${nextCursor.uidValidity ?? 'unknown'}:${msg.uid}`;
        // .returning() so a replayed failure (the row already exists, and
        // onConflictDoNothing makes the insert a no-op) does not inflate the
        // `created` counter the run log and UI report.
        const inserted = await db.insert(bankTransaction).values({
          id: createId(), orgId: integ.orgId, integrationId,
          messageId: failedMessageId,
          amount: 0, currency: 'CZK', valueDate: (parseResult.receivedAt ?? now()).toISOString().slice(0, 10),
          status: 'parse_failed', statusReason: `${parseResult.reason}: ${parseResult.detail}`,
          rawTokens: parseResult.tokens,
          receivedAt: parseResult.receivedAt ?? now(),
        }).onConflictDoNothing().returning({ id: bankTransaction.id });
        if (inserted.length > 0) created += 1;
        continue;
      }

      const parsed = parseResult.value;
      const existing = await db.select({ id: bankTransaction.id }).from(bankTransaction)
        .where(and(eq(bankTransaction.orgId, integ.orgId), eq(bankTransaction.messageId, parsed.messageId)));
      if (existing.length > 0) continue; // already imported

      const outcome = await decide(db, integ.orgId, integ.accountNumber, parsed, rules);

      // One transaction per message: the staging row and its payment are
      // created together or not at all.
      let insertedPaymentId: string | null = null;
      await db.transaction(async (tx) => {
        let paymentId: string | null = null;
        if (outcome.status === 'matched' && outcome.contractId) {
          paymentId = createId();
          await tx.insert(payment).values({
            id: paymentId, orgId: integ.orgId, contractId: outcome.contractId,
            amount: parsed.amount, paidAt: parsed.valueDate,
            counterparty: null,                       // KB sends no payer name
            counterpartyAccount: parsed.fromAccount,
            externalId: `kbemail:${parsed.messageId}`, // second idempotency guard
            statementRef: parsed.sourceLink,
            source: 'bank',
            description: buildDescription(parsed),
          });
        }
        await tx.insert(bankTransaction).values({
          id: createId(), orgId: integ.orgId, integrationId,
          messageId: parsed.messageId,
          amount: parsed.amount, currency: parsed.currency, valueDate: parsed.valueDate,
          fromAccount: parsed.fromAccount, toAccount: parsed.toAccount,
          vs: parsed.vs, ks: parsed.ks, ss: parsed.ss,
          messageForRecipient: parsed.messageForRecipient,
          sourceLink: parsed.sourceLink, rawTokens: parsed.tokens,
          status: outcome.status, statusReason: outcome.statusReason,
          duplicateOfTransactionId: outcome.duplicateOf,
          matchedBy: paymentId ? 'rule' : null,
          paymentId,
          receivedAt: parsed.receivedAt,
        });
        insertedPaymentId = paymentId;
      });
      // Counters advance only after the transaction COMMITS. Incrementing inside
      // the callback would leave them overstated if it rolled back, and the
      // counters are what the UI and the run log report.
      created += 1;
      if (insertedPaymentId) matched += 1;
    }

    // The cursor advances even when a message failed to parse — otherwise one
    // malformed e-mail wedges the integration forever. The parse_failed row is
    // what keeps it from being lost.
    await db.update(bankIntegration).set({
      uidValidity: nextCursor.uidValidity,
      lastUid: nextCursor.lastUid,
      lastSyncAt: now(),
      lastSyncStatus: failed > 0 ? 'error' : 'ok',
      lastSyncError: failed > 0 ? error : null,
    }).where(eq(bankIntegration.id, integrationId));

    await db.update(bankSyncRun).set({
      finishedAt: now(), status: failed > 0 ? 'error' : 'ok',
      fetched, created, matched, failed, error,
    }).where(eq(bankSyncRun.id, runId));

    return { runId, integrationId, fetched, created, matched, failed, status: failed > 0 ? 'error' : 'ok', error };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Deliberately does NOT stamp lastSyncAt. That column doubles as the
    // date-search floor (`sinceFallback`) used whenever the UID cursor is
    // unusable, so advancing it on a FAILED run has two silent consequences:
    // anything fetched-but-unprocessed in this run falls outside the next
    // run's SINCE window and is never offered again, and the 90-day first-run
    // backfill is truncated to "today". The likeliest first failure is a wrong
    // Gmail app password — stamping it here would mean that after fixing the
    // password the user only ever sees mail from the day of the fix, with no
    // error to explain the gap. lastSyncAt means "floor below which everything
    // is accounted for"; only a run that completed its batch may move it.
    await db.update(bankIntegration).set({
      lastSyncStatus: 'error', lastSyncError: message,
    }).where(eq(bankIntegration.id, integrationId));
    await db.update(bankSyncRun).set({
      finishedAt: now(), status: 'error', fetched, created, matched, failed, error: message,
    }).where(eq(bankSyncRun.id, runId));
    return { runId, integrationId, fetched, created, matched, failed, status: 'error', error: message };
  }
}

/**
 * Every active integration across ALL orgs — the cron path.
 *
 * One integration's failure must not stop the rest, so syncIntegration's own
 * error handling is relied on and results are collected rather than thrown.
 */
export async function syncAllActiveIntegrations(db: DB, deps: SyncDeps): Promise<SyncResult[]> {
  const rows = await db.select({ id: bankIntegration.id }).from(bankIntegration)
    .where(eq(bankIntegration.active, true));
  const results: SyncResult[] = [];
  for (const row of rows) {
    results.push(await syncIntegration(db, row.id, deps, 'cron'));
  }
  return results;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/bank-sync.test.ts`
Expected: PASS — 16 tests

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm build
git add core/services/bank-sync.ts tests/bank-sync.test.ts tests/helpers/fake-imap.ts
git commit -m "feat(core): bank sync orchestration with staging and a resend guard

Fetcher is injected, so every test runs offline against an in-memory fake.

Two behaviours worth naming. A parse failure stores a parse_failed row and the
cursor still advances — otherwise one malformed e-mail wedges the integration
forever — while an unrelated e-mail is skipped without escalating the
integration to error, so a stray newsletter cannot cry wolf.

The resend guard covers what Message-ID uniqueness cannot: KB re-sending a
notification for money already collected. An identical fingerprint whose
original produced a payment yields suspected_duplicate with no payment, held in
the inbox rather than discarded, because two genuinely identical transfers on
one day are possible and dropping one would lose real money."
```

---

### Task 8: `bank-integration` service — CRUD and test-connection

**Files:**
- Create: `core/services/bank-integration.ts`
- Test: covered by Task 11's route tests (this task's step 4 is a typecheck-only gate)

**Interfaces:**
- Consumes: `seal` (Task 1), `probeConnection`/`ImapConfig` (Task 6), `open` (Task 1).
- Produces:
  - `interface BankIntegrationRow` — the columns safe to return, plus `imapPasswordSet: boolean`. Omits `imapPasswordEnc` (the credential) and also `uidValidity`/`lastUid` (internal sync-cursor state that no consumer needs).
  - `requireOwner(ctx: AuthContext): void`
  - `listBankIntegrations(db, orgId): Promise<BankIntegrationRow[]>`
  - `getBankIntegration(db, orgId, id): Promise<BankIntegrationRow>`
  - `createBankIntegration(db, orgId, key, input: CreateInput): Promise<BankIntegrationRow>`
  - `updateBankIntegration(db, orgId, id, key, patch: UpdateInput): Promise<BankIntegrationRow>`
  - `deleteBankIntegration(db, orgId, id): Promise<void>`
  - `testBankIntegration(db, orgId, id, key): Promise<{ ok: boolean; mailboxExists?: number; error?: string }>`

- [ ] **Step 1: Write the implementation**

Create `core/services/bank-integration.ts`:

```ts
import { createId } from '@paralleldrive/cuid2';
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { bankIntegration } from '../db/schema.js';
import { AppError } from '../errors.js';
import type { AuthContext } from '../auth/context.js';
import { seal, open } from '../lib/crypto-box.js';
import { probeConnection, type ImapConfig } from '../lib/imap-fetcher.js';

/**
 * Bank integrations and the transaction inbox are owner-only.
 *
 * A member restricted to one property must not see org-wide bank traffic: an
 * unassigned transaction is by definition not yet attributable to a property,
 * so allowedPropertyIds cannot express the right answer here.
 */
export function requireOwner(ctx: AuthContext): void {
  if (ctx.role !== 'owner') throw new AppError('forbidden', 'pouze vlastník organizace může spravovat bankovní integrace');
}

export interface BankIntegrationRow {
  id: string;
  orgId: string;
  kind: 'kb_email';
  name: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  /** Never the value — only whether one is stored. */
  imapPasswordSet: boolean;
  imapFolder: string;
  fromFilter: string;
  subjectFilter: string;
  accountNumber: string | null;
  active: boolean;
  lastSyncAt: Date | null;
  lastSyncStatus: 'ok' | 'error' | null;
  lastSyncError: string | null;
  createdAt: Date;
}

// Selecting explicitly rather than `select()` so imapPasswordEnc can never leak
// into a response by someone adding a column later.
const selectShape = {
  id: bankIntegration.id,
  orgId: bankIntegration.orgId,
  kind: bankIntegration.kind,
  name: bankIntegration.name,
  imapHost: bankIntegration.imapHost,
  imapPort: bankIntegration.imapPort,
  imapUser: bankIntegration.imapUser,
  imapFolder: bankIntegration.imapFolder,
  fromFilter: bankIntegration.fromFilter,
  subjectFilter: bankIntegration.subjectFilter,
  accountNumber: bankIntegration.accountNumber,
  active: bankIntegration.active,
  lastSyncAt: bankIntegration.lastSyncAt,
  lastSyncStatus: bankIntegration.lastSyncStatus,
  lastSyncError: bankIntegration.lastSyncError,
  createdAt: bankIntegration.createdAt,
} as const;

function withPasswordFlag(row: Omit<BankIntegrationRow, 'imapPasswordSet'>): BankIntegrationRow {
  return { ...row, imapPasswordSet: true };
}

export interface CreateInput {
  name: string;
  imapHost: string;
  imapPort?: number;
  imapUser: string;
  imapPassword: string;
  imapFolder?: string;
  fromFilter?: string;
  subjectFilter?: string;
  accountNumber?: string | null;
  active?: boolean;
}

export type UpdateInput = Partial<Omit<CreateInput, 'imapPassword'>> & { imapPassword?: string };

export async function listBankIntegrations(db: DB, orgId: string): Promise<BankIntegrationRow[]> {
  const rows = await db.select(selectShape).from(bankIntegration)
    .where(eq(bankIntegration.orgId, orgId))
    .orderBy(desc(bankIntegration.createdAt));
  return rows.map(withPasswordFlag);
}

export async function getBankIntegration(db: DB, orgId: string, id: string): Promise<BankIntegrationRow> {
  const [row] = await db.select(selectShape).from(bankIntegration)
    .where(and(eq(bankIntegration.id, id), eq(bankIntegration.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'bankovní integrace nenalezena');
  return withPasswordFlag(row);
}

export async function createBankIntegration(
  db: DB, orgId: string, key: Buffer, input: CreateInput,
): Promise<BankIntegrationRow> {
  const id = createId();
  await db.insert(bankIntegration).values({
    id, orgId, kind: 'kb_email',
    name: input.name,
    imapHost: input.imapHost,
    imapPort: input.imapPort ?? 993,
    imapUser: input.imapUser,
    imapPasswordEnc: seal(input.imapPassword, key),
    imapFolder: input.imapFolder ?? 'INBOX',
    fromFilter: input.fromFilter ?? 'servis@kbinfo.cz',
    subjectFilter: input.subjectFilter ?? 'Přijali jsme platbu',
    accountNumber: input.accountNumber ?? null,
    active: input.active ?? true,
  });
  return getBankIntegration(db, orgId, id);
}

export async function updateBankIntegration(
  db: DB, orgId: string, id: string, key: Buffer, patch: UpdateInput,
): Promise<BankIntegrationRow> {
  await getBankIntegration(db, orgId, id); // existence + org scope
  const set: Record<string, unknown> = {};
  for (const field of ['name', 'imapHost', 'imapPort', 'imapUser', 'imapFolder', 'fromFilter', 'subjectFilter', 'accountNumber', 'active'] as const) {
    if (patch[field] !== undefined) set[field] = patch[field];
  }
  // An omitted password leaves the stored one untouched — the UI sends a value
  // only when it was actually retyped.
  if (patch.imapPassword !== undefined && patch.imapPassword !== '') {
    set['imapPasswordEnc'] = seal(patch.imapPassword, key);
  }
  if (Object.keys(set).length > 0) {
    await db.update(bankIntegration).set(set).where(and(eq(bankIntegration.id, id), eq(bankIntegration.orgId, orgId)));
  }
  return getBankIntegration(db, orgId, id);
}

export async function deleteBankIntegration(db: DB, orgId: string, id: string): Promise<void> {
  await getBankIntegration(db, orgId, id);
  await db.delete(bankIntegration).where(and(eq(bankIntegration.id, id), eq(bankIntegration.orgId, orgId)));
}

/**
 * Deliberately NOT exported. The returned `ImapConfig` carries the decrypted
 * password in a field literally named `password`, so an exported version is one
 * careless `import` away from a route handler serialising it into a response —
 * which would defeat the write-only-password invariant this whole service is
 * built around. `testBankIntegration` is the only caller; keep it that way, and
 * if another module ever needs a live IMAP config, give it a function that
 * consumes the config rather than one that returns it.
 */
async function loadImapConfig(db: DB, orgId: string, id: string, key: Buffer): Promise<ImapConfig> {
  const [row] = await db.select().from(bankIntegration)
    .where(and(eq(bankIntegration.id, id), eq(bankIntegration.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'bankovní integrace nenalezena');
  return {
    host: row.imapHost, port: row.imapPort, user: row.imapUser,
    password: open(row.imapPasswordEnc, key), folder: row.imapFolder,
  };
}

export async function testBankIntegration(
  db: DB, orgId: string, id: string, key: Buffer,
): Promise<{ ok: boolean; mailboxExists?: number; error?: string }> {
  let cfg: ImapConfig;
  try {
    cfg = await loadImapConfig(db, orgId, id, key);
  } catch (e) {
    if (e instanceof AppError) throw e;
    return { ok: false, error: `nelze dešifrovat heslo — zkontroluj SECRET_ENCRYPTION_KEY` };
  }
  const result = await probeConnection(cfg);
  return result.ok ? { ok: true, mailboxExists: result.mailboxExists } : { ok: false, error: result.error };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: no errors. (Behaviour is exercised by Task 11's route tests — this service has no logic worth testing in isolation beyond what those cover.)

- [ ] **Step 3: Commit**

```bash
git add core/services/bank-integration.ts
git commit -m "feat(core): bank integration CRUD with a write-only password

selectShape lists columns explicitly rather than select(*), so imapPasswordEnc
cannot leak into a response when someone adds a column later. An omitted
password on update leaves the stored one untouched. requireOwner gates the
whole resource: allowedPropertyIds cannot express access to org-wide bank
traffic, since an unassigned transaction has no property yet."
```

---

### Task 9: `bank-transaction` service — the inbox

**Files:**
- Create: `core/services/bank-transaction.ts`
- Test: covered by Task 11's route tests

**Interfaces:**
- Consumes: `requireOwner` (Task 8), `parseFromTokens` (Task 3), `buildDescription` (Task 7).
- Produces:
  - `listBankTransactions(db, orgId, filters: { status?: string; pendingOnly?: boolean }): Promise<BankTransactionRow[]>`
  - `assignBankTransaction(db, orgId, id, contractId): Promise<BankTransactionRow>`
  - `ignoreBankTransaction(db, orgId, id): Promise<BankTransactionRow>`
  - `reparseBankTransaction(db, orgId, id): Promise<BankTransactionRow>`

- [ ] **Step 1: Write the implementation**

Create `core/services/bank-transaction.ts`:

```ts
import { createId } from '@paralleldrive/cuid2';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { bankTransaction, contract, payment, property, tenant } from '../db/schema.js';
import { AppError } from '../errors.js';
import { parseFromTokens } from '../lib/kb-email-parser.js';
import { buildDescription } from './bank-sync.js';

export interface BankTransactionRow {
  id: string;
  orgId: string;
  integrationId: string;
  messageId: string;
  amount: number;
  currency: string;
  valueDate: string;
  fromAccount: string | null;
  toAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  messageForRecipient: string | null;
  sourceLink: string | null;
  status: string;
  statusReason: string | null;
  duplicateOfTransactionId: string | null;
  matchedBy: 'rule' | 'manual' | null;
  paymentId: string | null;
  receivedAt: Date;
  createdAt: Date;
  contractId: string | null;
  propertyName: string | null;
  tenantName: string | null;
}

const selectShape = {
  id: bankTransaction.id,
  orgId: bankTransaction.orgId,
  integrationId: bankTransaction.integrationId,
  messageId: bankTransaction.messageId,
  amount: bankTransaction.amount,
  currency: bankTransaction.currency,
  valueDate: bankTransaction.valueDate,
  fromAccount: bankTransaction.fromAccount,
  toAccount: bankTransaction.toAccount,
  vs: bankTransaction.vs,
  ks: bankTransaction.ks,
  ss: bankTransaction.ss,
  messageForRecipient: bankTransaction.messageForRecipient,
  sourceLink: bankTransaction.sourceLink,
  status: bankTransaction.status,
  statusReason: bankTransaction.statusReason,
  duplicateOfTransactionId: bankTransaction.duplicateOfTransactionId,
  matchedBy: bankTransaction.matchedBy,
  paymentId: bankTransaction.paymentId,
  receivedAt: bankTransaction.receivedAt,
  createdAt: bankTransaction.createdAt,
  contractId: payment.contractId,
  propertyName: property.name,
  tenantName: tenant.name,
} as const;

function baseQuery(db: DB) {
  return db.select(selectShape).from(bankTransaction)
    .leftJoin(payment, eq(payment.id, bankTransaction.paymentId))
    .leftJoin(contract, and(eq(contract.id, payment.contractId), eq(contract.orgId, bankTransaction.orgId)))
    .leftJoin(property, eq(property.id, contract.propertyId))
    .leftJoin(tenant, eq(tenant.id, contract.tenantId));
}

export async function listBankTransactions(
  db: DB, orgId: string, filters: { status?: string; pendingOnly?: boolean } = {},
): Promise<BankTransactionRow[]> {
  const conds = [eq(bankTransaction.orgId, orgId)];
  if (filters.status) conds.push(eq(bankTransaction.status, filters.status as 'unmatched'));
  if (filters.pendingOnly) {
    // `paymentId IS NULL` is the source of truth for "needs attention": if the
    // user deletes a created payment the FK nulls out, and no trigger can
    // rewrite `status`, so status is advisory metadata only.
    conds.push(isNull(bankTransaction.paymentId));
    conds.push(ne(bankTransaction.status, 'ignored'));
  }
  return baseQuery(db).where(and(...conds)).orderBy(desc(bankTransaction.valueDate)) as Promise<BankTransactionRow[]>;
}

async function getRaw(db: DB, orgId: string, id: string) {
  const [row] = await db.select().from(bankTransaction)
    .where(and(eq(bankTransaction.id, id), eq(bankTransaction.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'bankovní transakce nenalezena');
  return row;
}

export async function getBankTransaction(db: DB, orgId: string, id: string): Promise<BankTransactionRow> {
  const [row] = await baseQuery(db).where(and(eq(bankTransaction.id, id), eq(bankTransaction.orgId, orgId)));
  if (!row) throw new AppError('not_found', 'bankovní transakce nenalezena');
  return row as BankTransactionRow;
}

/**
 * Create the payment for a transaction and link it.
 *
 * Also the confirmation path for a suspected duplicate — "Není duplikát —
 * spárovat" is just a manual assignment, so it needs no separate endpoint.
 */
export async function assignBankTransaction(
  db: DB, orgId: string, id: string, contractId: string,
): Promise<BankTransactionRow> {
  const row = await getRaw(db, orgId, id);
  if (row.paymentId !== null) throw new AppError('conflict', 'transakce už je spárovaná s platbou');
  if (row.status === 'parse_failed') throw new AppError('bad_request', 'nelze spárovat transakci, kterou se nepodařilo zpracovat');

  const [c] = await db.select().from(contract)
    .where(and(eq(contract.id, contractId), eq(contract.orgId, orgId)));
  if (!c) throw new AppError('not_found', 'pronájem nenalezen');

  await db.transaction(async (tx) => {
    const paymentId = createId();
    await tx.insert(payment).values({
      id: paymentId, orgId, contractId,
      amount: row.amount, paidAt: row.valueDate,
      counterparty: null, counterpartyAccount: row.fromAccount,
      externalId: `kbemail:${row.messageId}`,
      statementRef: row.sourceLink, source: 'bank',
      description: buildDescription(row), // row satisfies DescribableTransaction
    });
    await tx.update(bankTransaction)
      .set({ paymentId, status: 'matched', matchedBy: 'manual', statusReason: null })
      .where(eq(bankTransaction.id, id));
  });
  return getBankTransaction(db, orgId, id);
}

export async function ignoreBankTransaction(db: DB, orgId: string, id: string): Promise<BankTransactionRow> {
  const row = await getRaw(db, orgId, id);
  if (row.paymentId !== null) throw new AppError('conflict', 'transakce už je spárovaná — nejdřív smaž platbu');
  await db.update(bankTransaction).set({ status: 'ignored' }).where(eq(bankTransaction.id, id));
  return getBankTransaction(db, orgId, id);
}

/**
 * Re-run the parser over the stored token snapshot, after a parser fix. No IMAP
 * involved — this is why rawTokens is persisted.
 */
export async function reparseBankTransaction(db: DB, orgId: string, id: string): Promise<BankTransactionRow> {
  const row = await getRaw(db, orgId, id);
  if (!row.rawTokens || row.rawTokens.length === 0) {
    throw new AppError('bad_request', 'transakce nemá uložená data k opětovnému zpracování');
  }
  const result = parseFromTokens(row.rawTokens, {
    messageId: row.messageId, receivedAt: row.receivedAt, sourceLink: row.sourceLink,
  });
  if (!result.ok) {
    await db.update(bankTransaction)
      .set({ status: 'parse_failed', statusReason: `${result.reason}: ${result.detail}` })
      .where(eq(bankTransaction.id, id));
    return getBankTransaction(db, orgId, id);
  }
  const p = result.value;
  // Back to 'unmatched' rather than re-running the rules: a reparse is a repair
  // of the record, and the next sync (or a manual assign) does the pairing.
  await db.update(bankTransaction).set({
    amount: p.amount, currency: p.currency, valueDate: p.valueDate,
    fromAccount: p.fromAccount, toAccount: p.toAccount,
    vs: p.vs, ks: p.ks, ss: p.ss, messageForRecipient: p.messageForRecipient,
    status: 'unmatched', statusReason: null,
  }).where(eq(bankTransaction.id, id));
  return getBankTransaction(db, orgId, id);
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
pnpm build
git add core/services/bank-transaction.ts
git commit -m "feat(core): bank transaction inbox — list, assign, ignore, reparse

The pending filter keys on paymentId IS NULL, not status: deleting a created
payment nulls the FK and no trigger can rewrite status, so status is advisory
and the FK is authoritative. Confirming a suspected duplicate reuses assign
rather than adding an endpoint — it IS a manual assignment. Reparse works off
the stored rawTokens with no IMAP round-trip, which is why they are persisted."
```

---

### Task 10: `payment-rule` service and derived health

**Files:**
- Create: `core/services/payment-rule.ts`
- Test: `tests/payment-rule.test.ts`

**Interfaces:**
- Consumes: `validateRuleCriteria` (Task 4).
- Produces:
  - `type PairingHealth = { state: 'nenastaveno' | 'ok' | 'chyba'; message: string | null; lastSyncAt: Date | null }`
  - `computePairingHealth(rule, integrations): PairingHealth` (pure)
  - `getPaymentRule(db, orgId, contractId, allowedPropertyIds): Promise<{ rule: PaymentRuleRow | null; health: PairingHealth }>`
  - `upsertPaymentRule(db, orgId, contractId, allowedPropertyIds, input): Promise<PaymentRuleRow>`
  - `deletePaymentRule(db, orgId, contractId, allowedPropertyIds): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/payment-rule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computePairingHealth } from '../core/services/payment-rule.js';

const RULE = { active: true } as const;
const okIntegration = { active: true, lastSyncStatus: 'ok' as const, lastSyncError: null, lastSyncAt: new Date('2026-08-20T05:00:00Z') };

describe('computePairingHealth', () => {
  it('is nenastaveno with no integration', () => {
    expect(computePairingHealth(RULE, []).state).toBe('nenastaveno');
  });

  it('is nenastaveno with no rule', () => {
    expect(computePairingHealth(null, [okIntegration]).state).toBe('nenastaveno');
  });

  it('is nenastaveno when the rule is switched off', () => {
    expect(computePairingHealth({ active: false }, [okIntegration]).state).toBe('nenastaveno');
  });

  it('is nenastaveno when every integration is inactive', () => {
    expect(computePairingHealth(RULE, [{ ...okIntegration, active: false }]).state).toBe('nenastaveno');
  });

  it('is ok when the last sync was clean', () => {
    const h = computePairingHealth(RULE, [okIntegration]);
    expect(h.state).toBe('ok');
    expect(h.lastSyncAt).toEqual(okIntegration.lastSyncAt);
  });

  it('is ok before the first sync has run', () => {
    expect(computePairingHealth(RULE, [{ active: true, lastSyncStatus: null, lastSyncError: null, lastSyncAt: null }]).state).toBe('ok');
  });

  it('is chyba and surfaces the error when a sync failed', () => {
    const h = computePairingHealth(RULE, [{ ...okIntegration, lastSyncStatus: 'error', lastSyncError: 'AUTHENTICATIONFAILED' }]);
    expect(h.state).toBe('chyba');
    expect(h.message).toBe('AUTHENTICATIONFAILED');
  });

  it('reports chyba if ANY active integration is failing', () => {
    const h = computePairingHealth(RULE, [okIntegration, { ...okIntegration, lastSyncStatus: 'error', lastSyncError: 'boom' }]);
    expect(h.state).toBe('chyba');
  });

  it('ignores a failing INACTIVE integration', () => {
    const h = computePairingHealth(RULE, [okIntegration, { active: false, lastSyncStatus: 'error', lastSyncError: 'boom', lastSyncAt: null }]);
    expect(h.state).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/payment-rule.test.ts`
Expected: FAIL — `Cannot find module '../core/services/payment-rule.js'`

- [ ] **Step 3: Write the implementation**

Create `core/services/payment-rule.ts`:

```ts
import { createId } from '@paralleldrive/cuid2';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { bankIntegration, contract, paymentMatchingRule } from '../db/schema.js';
import { AppError } from '../errors.js';
import { validateRuleCriteria } from '../lib/payment-pairing.js';

export interface PaymentRuleRow {
  id: string;
  orgId: string;
  contractId: string;
  counterpartyAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  amountFrom: number | null;
  amountTo: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PairingHealth {
  state: 'nenastaveno' | 'ok' | 'chyba';
  message: string | null;
  lastSyncAt: Date | null;
}

interface HealthIntegration {
  active: boolean;
  lastSyncStatus: 'ok' | 'error' | null;
  lastSyncError: string | null;
  lastSyncAt: Date | null;
}

/**
 * "Stav" on the Párování plateb card: operational health of the pairing, not
 * arrears and not static rule validation.
 *
 * Pure and derived on read — storing it would let it go stale the moment a sync
 * ran.
 */
export function computePairingHealth(
  rule: { active: boolean } | null,
  integrations: HealthIntegration[],
): PairingHealth {
  const live = integrations.filter((i) => i.active);
  if (rule === null || !rule.active || live.length === 0) {
    return { state: 'nenastaveno', message: null, lastSyncAt: null };
  }
  // An inactive integration's stale error must not colour the pill — the user
  // switched it off deliberately.
  const failing = live.find((i) => i.lastSyncStatus === 'error');
  if (failing) {
    return { state: 'chyba', message: failing.lastSyncError, lastSyncAt: failing.lastSyncAt };
  }
  const latest = live
    .map((i) => i.lastSyncAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return { state: 'ok', message: null, lastSyncAt: latest };
}

async function assertContract(db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null) {
  const [c] = await db.select().from(contract).where(and(eq(contract.id, contractId), eq(contract.orgId, orgId)));
  if (!c) throw new AppError('not_found', 'pronájem nenalezen');
  if (allowedPropertyIds !== null && !allowedPropertyIds.includes(c.propertyId)) {
    throw new AppError('forbidden', 'no access');
  }
  return c;
}

export async function getPaymentRule(
  db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null,
): Promise<{ rule: PaymentRuleRow | null; health: PairingHealth }> {
  await assertContract(db, orgId, contractId, allowedPropertyIds);
  const [rule] = await db.select().from(paymentMatchingRule)
    .where(and(eq(paymentMatchingRule.orgId, orgId), eq(paymentMatchingRule.contractId, contractId)));
  const integrations = await db.select({
    active: bankIntegration.active,
    lastSyncStatus: bankIntegration.lastSyncStatus,
    lastSyncError: bankIntegration.lastSyncError,
    lastSyncAt: bankIntegration.lastSyncAt,
  }).from(bankIntegration).where(eq(bankIntegration.orgId, orgId));
  return {
    rule: (rule as PaymentRuleRow | undefined) ?? null,
    health: computePairingHealth(rule ?? null, integrations),
  };
}

export interface PaymentRuleInput {
  counterpartyAccount?: string | null;
  vs?: string | null;
  ks?: string | null;
  ss?: string | null;
  amountFrom?: number | null;
  amountTo?: number | null;
  active?: boolean;
}

export async function upsertPaymentRule(
  db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null, input: PaymentRuleInput,
): Promise<PaymentRuleRow> {
  await assertContract(db, orgId, contractId, allowedPropertyIds);
  const criteria = {
    counterpartyAccount: input.counterpartyAccount ?? null,
    vs: input.vs ?? null,
    ks: input.ks ?? null,
    ss: input.ss ?? null,
    amountFrom: input.amountFrom ?? null,
    amountTo: input.amountTo ?? null,
  };
  const problem = validateRuleCriteria(criteria);
  if (problem) throw new AppError('validation', problem);

  const [existing] = await db.select().from(paymentMatchingRule)
    .where(and(eq(paymentMatchingRule.orgId, orgId), eq(paymentMatchingRule.contractId, contractId)));

  if (existing) {
    await db.update(paymentMatchingRule)
      .set({ ...criteria, active: input.active ?? existing.active, updatedAt: new Date() })
      .where(eq(paymentMatchingRule.id, existing.id));
  } else {
    await db.insert(paymentMatchingRule).values({
      id: createId(), orgId, contractId, ...criteria, active: input.active ?? true,
    });
  }
  const { rule } = await getPaymentRule(db, orgId, contractId, allowedPropertyIds);
  return rule!;
}

export async function deletePaymentRule(
  db: DB, orgId: string, contractId: string, allowedPropertyIds: string[] | null,
): Promise<void> {
  await assertContract(db, orgId, contractId, allowedPropertyIds);
  await db.delete(paymentMatchingRule)
    .where(and(eq(paymentMatchingRule.orgId, orgId), eq(paymentMatchingRule.contractId, contractId)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/payment-rule.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm build
git add core/services/payment-rule.ts tests/payment-rule.test.ts
git commit -m "feat(core): per-contract pairing rule with derived health

Health is computed on read, never stored — a stored pill would go stale the
moment a sync ran. An inactive integration's stale error is ignored, since the
user switched it off deliberately."
```

---

### Task 11: REST routes

**Files:**
- Create: `server/routes/bank.ts`
- Modify: `server/app.ts` — import and mount `bankRoutes()`
- Test: `tests/bank-routes.test.ts`

**Interfaces:**
- Consumes: every service from Tasks 8–10, plus `syncIntegration` (Task 7), `fetchMessagesOverImap` (Task 6), `loadKey` (Task 1).
- Produces: the endpoints listed in the spec's API surface table.

- [ ] **Step 1: Write the failing test**

Create `tests/bank-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import { freshDb } from './helpers/db.js';
import { makeApp } from './helpers/app.js';
import { registerUser } from './helpers/fixtures.js';
import { bankIntegration, bankTransaction, membership, propertyAccess } from '../core/db/schema.js';
import { eq } from 'drizzle-orm';

beforeAll(() => {
  process.env['SECRET_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
  process.env['CRON_SECRET'] = 'test-cron-secret';
});

const json = (cookie: string) => ({ 'content-type': 'application/json', cookie });

async function bootstrap() {
  const { db, client } = await freshDb();
  const app = makeApp(db);
  const { cookie } = await registerUser(app, 'owner@example.com', 'password123', 'Owner');
  await app.request('/api/organizations', { method: 'POST', headers: json(cookie), body: JSON.stringify({ name: 'O' }) });
  const p = (await (await app.request('/api/properties', { method: 'POST', headers: json(cookie), body: JSON.stringify({ name: 'P' }) })).json() as any).property;
  const t = (await (await app.request('/api/tenants', { method: 'POST', headers: json(cookie), body: JSON.stringify({ name: 'T' }) })).json() as any).tenant;
  const ct = (await (await app.request('/api/contracts', { method: 'POST', headers: json(cookie), body: JSON.stringify({ propertyId: p.id, tenantId: t.id, startDate: '2024-09-01' }) })).json() as any).contract;
  return { db, client, app, cookie, property: p, contract: ct };
}

const INTEGRATION = {
  name: 'KB', imapHost: 'imap.example.com', imapUser: 'u@example.com',
  imapPassword: 'app-password', accountNumber: '321-9876543210/0100',
};

describe('bank integration routes', () => {
  it('creates, lists, updates and deletes — never exposing the password', async () => {
    const { client, app, cookie } = await bootstrap();

    const create = await app.request('/api/bank-integrations', { method: 'POST', headers: json(cookie), body: JSON.stringify(INTEGRATION) });
    expect(create.status).toBe(201);
    const body = await create.text();
    // The single most important assertion in this file.
    expect(body).not.toContain('app-password');
    expect(body).not.toContain('imapPasswordEnc');
    const integration = JSON.parse(body).bankIntegration;
    expect(integration.imapPasswordSet).toBe(true);
    expect(integration.imapPort).toBe(993);
    expect(integration.subjectFilter).toBe('Přijali jsme platbu');

    const list = await app.request('/api/bank-integrations', { headers: { cookie } });
    expect(await list.clone().text()).not.toContain('app-password');
    expect((await list.json() as any).bankIntegrations).toHaveLength(1);

    // Omitting the password leaves the stored one untouched
    const patch = await app.request(`/api/bank-integrations/${integration.id}`, {
      method: 'PATCH', headers: json(cookie), body: JSON.stringify({ name: 'KB hlavní' }),
    });
    expect(patch.status).toBe(200);
    expect((await patch.json() as any).bankIntegration.name).toBe('KB hlavní');

    const del = await app.request(`/api/bank-integrations/${integration.id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(204);
    await client.close();
  });

  it('rejects a restricted member from the integration and inbox endpoints', async () => {
    const { db, client, app, cookie, property } = await bootstrap();
    await app.request('/api/bank-integrations', { method: 'POST', headers: json(cookie), body: JSON.stringify(INTEGRATION) });

    // A member scoped to the one property
    const { userId } = await registerUser(app, 'member@example.com', 'password123', 'Member');
    const login = await app.request('/api/auth/sign-in/email', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member@example.com', password: 'password123' }),
    });
    const memberCookie = login.headers.get('set-cookie') ?? '';
    const [org] = await db.select().from(membership);
    const memberMembership = createId();
    await db.insert(membership).values({ id: memberMembership, userId, orgId: org!.orgId, role: 'member' });
    await db.insert(propertyAccess).values({ membershipId: memberMembership, propertyId: property.id });

    expect((await app.request('/api/bank-integrations', { headers: { cookie: memberCookie } })).status).toBe(403);
    expect((await app.request('/api/bank-transactions', { headers: { cookie: memberCookie } })).status).toBe(403);
    await client.close();
  });

  it('404s on another org\'s integration', async () => {
    const { client, app, cookie } = await bootstrap();
    const mine = (await (await app.request('/api/bank-integrations', { method: 'POST', headers: json(cookie), body: JSON.stringify(INTEGRATION) })).json() as any).bankIntegration;

    const other = await registerUser(app, 'other@example.com', 'password123', 'Other');
    await app.request('/api/organizations', { method: 'POST', headers: json(other.cookie), body: JSON.stringify({ name: 'O2' }) });

    const res = await app.request(`/api/bank-integrations/${mine.id}`, { headers: { cookie: other.cookie } });
    expect(res.status).toBe(404);
    await client.close();
  });
});

describe('payment rule routes', () => {
  it('upserts, reads with health, and deletes', async () => {
    const { client, app, cookie, contract } = await bootstrap();

    const empty = await app.request(`/api/contracts/${contract.id}/payment-rule`, { headers: { cookie } });
    expect(empty.status).toBe(200);
    const emptyBody = await empty.json() as any;
    expect(emptyBody.rule).toBeNull();
    expect(emptyBody.health.state).toBe('nenastaveno');

    const put = await app.request(`/api/contracts/${contract.id}/payment-rule`, {
      method: 'PUT', headers: json(cookie),
      body: JSON.stringify({ counterpartyAccount: '294153028/0300', amountFrom: 3_500_000, amountTo: 4_120_000 }),
    });
    expect(put.status).toBe(200);
    expect((await put.json() as any).rule.amountFrom).toBe(3_500_000);

    // Upsert is idempotent — a second PUT updates rather than violating the
    // one-rule-per-contract constraint
    const put2 = await app.request(`/api/contracts/${contract.id}/payment-rule`, {
      method: 'PUT', headers: json(cookie), body: JSON.stringify({ vs: '2026008' }),
    });
    expect(put2.status).toBe(200);
    const rule2 = (await put2.json() as any).rule;
    expect(rule2.vs).toBe('2026008');
    expect(rule2.counterpartyAccount).toBeNull(); // PUT replaces, it does not merge

    // Still nenastaveno — a rule without an integration cannot pair anything
    const withRule = await (await app.request(`/api/contracts/${contract.id}/payment-rule`, { headers: { cookie } })).json() as any;
    expect(withRule.health.state).toBe('nenastaveno');

    await app.request('/api/bank-integrations', { method: 'POST', headers: json(cookie), body: JSON.stringify(INTEGRATION) });
    const healthy = await (await app.request(`/api/contracts/${contract.id}/payment-rule`, { headers: { cookie } })).json() as any;
    expect(healthy.health.state).toBe('ok');

    const del = await app.request(`/api/contracts/${contract.id}/payment-rule`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(204);
    await client.close();
  });

  it('rejects a rule with no criteria', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    const res = await app.request(`/api/contracts/${contract.id}/payment-rule`, {
      method: 'PUT', headers: json(cookie), body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    expect((await res.json() as any).error.message).toMatch(/alespoň jedno kritérium/);
    await client.close();
  });

  it('rejects an inverted amount band', async () => {
    const { client, app, cookie, contract } = await bootstrap();
    const res = await app.request(`/api/contracts/${contract.id}/payment-rule`, {
      method: 'PUT', headers: json(cookie), body: JSON.stringify({ amountFrom: 500, amountTo: 100 }),
    });
    expect(res.status).toBe(422);
    await client.close();
  });
});

describe('bank transaction routes', () => {
  async function withTransaction() {
    const ctx = await bootstrap();
    const integration = (await (await ctx.app.request('/api/bank-integrations', { method: 'POST', headers: json(ctx.cookie), body: JSON.stringify(INTEGRATION) })).json() as any).bankIntegration;
    const txId = createId();
    await ctx.db.insert(bankTransaction).values({
      id: txId, orgId: (await ctx.db.select().from(bankIntegration))[0]!.orgId,
      integrationId: integration.id, messageId: 'm1',
      amount: 3_800_000, currency: 'CZK', valueDate: '2026-08-20',
      fromAccount: '294153028/0300', toAccount: '321-9876543210/0100',
      status: 'unmatched', receivedAt: new Date(),
    });
    return { ...ctx, txId };
  }

  it('lists pending transactions and assigns one to a contract', async () => {
    const { client, app, cookie, contract, txId, db } = await withTransaction();

    const list = await app.request('/api/bank-transactions?pending=1', { headers: { cookie } });
    expect(list.status).toBe(200);
    expect((await list.json() as any).bankTransactions).toHaveLength(1);

    const assign = await app.request(`/api/bank-transactions/${txId}/assign`, {
      method: 'POST', headers: json(cookie), body: JSON.stringify({ contractId: contract.id }),
    });
    expect(assign.status).toBe(200);
    const assigned = (await assign.json() as any).bankTransaction;
    expect(assigned.status).toBe('matched');
    expect(assigned.matchedBy).toBe('manual');
    expect(assigned.paymentId).not.toBeNull();
    expect(assigned.contractId).toBe(contract.id);

    // It leaves the pending list once paired
    const after = await (await app.request('/api/bank-transactions?pending=1', { headers: { cookie } })).json() as any;
    expect(after.bankTransactions).toHaveLength(0);

    // Assigning twice conflicts
    const again = await app.request(`/api/bank-transactions/${txId}/assign`, {
      method: 'POST', headers: json(cookie), body: JSON.stringify({ contractId: contract.id }),
    });
    expect(again.status).toBe(409);

    // Deleting the payment returns it to the inbox — paymentId is the truth
    const [tx] = await db.select().from(bankTransaction).where(eq(bankTransaction.id, txId));
    await app.request(`/api/payments/${tx!.paymentId}`, { method: 'DELETE', headers: { cookie } });
    const reopened = await (await app.request('/api/bank-transactions?pending=1', { headers: { cookie } })).json() as any;
    expect(reopened.bankTransactions).toHaveLength(1);
    await client.close();
  });

  it('ignores a transaction', async () => {
    const { client, app, cookie, txId } = await withTransaction();
    const res = await app.request(`/api/bank-transactions/${txId}/ignore`, { method: 'POST', headers: json(cookie), body: '{}' });
    expect(res.status).toBe(200);
    expect((await res.json() as any).bankTransaction.status).toBe('ignored');
    const list = await (await app.request('/api/bank-transactions?pending=1', { headers: { cookie } })).json() as any;
    expect(list.bankTransactions).toHaveLength(0);
    await client.close();
  });
});

describe('cron endpoint', () => {
  it('refuses without the secret', async () => {
    const { client, app } = await bootstrap();
    expect((await app.request('/api/cron/bank-sync')).status).toBe(401);
    expect((await app.request('/api/cron/bank-sync', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await app.request('/api/cron/bank-sync', { headers: { authorization: 'Bearer ' } })).status).toBe(401);
    await client.close();
  });

  it('accepts the correct secret and reports per-integration results', async () => {
    const { client, app } = await bootstrap();
    const res = await app.request('/api/cron/bank-sync', { headers: { authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results).toEqual([]); // no integrations in this fresh org
    await client.close();
  });

  it('refuses everything when CRON_SECRET is unset — never runs open', async () => {
    const saved = process.env['CRON_SECRET'];
    delete process.env['CRON_SECRET'];
    try {
      const { client, app } = await bootstrap();
      expect((await app.request('/api/cron/bank-sync', { headers: { authorization: 'Bearer anything' } })).status).toBe(401);
      await client.close();
    } finally {
      process.env['CRON_SECRET'] = saved;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/bank-routes.test.ts`
Expected: FAIL — 404s on every new endpoint

- [ ] **Step 3: Write the routes**

Create `server/routes/bank.ts`:

```ts
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getCtx } from '../middleware/auth.js';
import { requireOrg } from '../../core/auth/context.js';
import { AppError } from '../../core/errors.js';
import { loadKey } from '../../core/lib/crypto-box.js';
import { fetchMessagesOverImap } from '../../core/lib/imap-fetcher.js';
import {
  requireOwner, listBankIntegrations, getBankIntegration, createBankIntegration,
  updateBankIntegration, deleteBankIntegration, testBankIntegration,
} from '../../core/services/bank-integration.js';
import {
  listBankTransactions, assignBankTransaction, ignoreBankTransaction, reparseBankTransaction,
} from '../../core/services/bank-transaction.js';
import { getPaymentRule, upsertPaymentRule, deletePaymentRule } from '../../core/services/payment-rule.js';
import { syncIntegration, syncAllActiveIntegrations } from '../../core/services/bank-sync.js';
import type { AppEnv } from '../app.js';

const Haler = z.number().int();

const CreateIntegration = z.object({
  name: z.string().min(1),
  imapHost: z.string().min(1),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapUser: z.string().min(1),
  imapPassword: z.string().min(1),
  imapFolder: z.string().min(1).optional(),
  fromFilter: z.string().min(1).optional(),
  subjectFilter: z.string().min(1).optional(),
  accountNumber: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

const UpdateIntegration = CreateIntegration.partial();

const RuleBody = z.object({
  counterpartyAccount: z.string().nullable().optional(),
  vs: z.string().nullable().optional(),
  ks: z.string().nullable().optional(),
  ss: z.string().nullable().optional(),
  amountFrom: Haler.nullable().optional(),
  amountTo: Haler.nullable().optional(),
  active: z.boolean().optional(),
});

const AssignBody = z.object({ contractId: z.string().min(1) });

function bankKey(): Buffer {
  // Deliberately NOT wrapped in an AppError. A missing or malformed
  // SECRET_ENCRYPTION_KEY is a SERVER misconfiguration, and AppError('bad_request')
  // maps to HTTP 400 — which tells the client their request was malformed when
  // the deployment is the thing that is broken. core/errors.ts has no
  // 'internal' kind, so letting the plain Error propagate is the correct
  // choice: it reaches errorMiddleware's generic branch, which console.error's
  // the cause for the operator and returns a 500 that leaks nothing to the
  // caller. cronRoutes() already calls loadKey bare for the identical failure,
  // so this also makes the two entry points report it the same way instead of
  // 400-here / 500-there during a real misconfiguration incident.
  return loadKey(process.env['SECRET_ENCRYPTION_KEY']);
}

export function bankRoutes() {
  const r = new Hono<AppEnv>();

  // ── Integrations (owner-only) ─────────────────────────────────────────────
  r.get('/bank-integrations', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    return c.json({ bankIntegrations: await listBankIntegrations(c.get('db'), ctx.orgId) });
  });

  r.post('/bank-integrations', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    const body = CreateIntegration.parse(await c.req.json());
    const row = await createBankIntegration(c.get('db'), ctx.orgId, bankKey(), body);
    return c.json({ bankIntegration: row }, 201);
  });

  r.get('/bank-integrations/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    return c.json({ bankIntegration: await getBankIntegration(c.get('db'), ctx.orgId, c.req.param('id')) });
  });

  r.patch('/bank-integrations/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    const body = UpdateIntegration.parse(await c.req.json());
    return c.json({ bankIntegration: await updateBankIntegration(c.get('db'), ctx.orgId, c.req.param('id'), bankKey(), body) });
  });

  r.delete('/bank-integrations/:id', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    await deleteBankIntegration(c.get('db'), ctx.orgId, c.req.param('id'));
    return c.body(null, 204);
  });

  r.post('/bank-integrations/:id/test', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    return c.json(await testBankIntegration(c.get('db'), ctx.orgId, c.req.param('id'), bankKey()));
  });

  r.post('/bank-integrations/:id/sync', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    // Ownership check BEFORE syncIntegration, which resolves orgId from the row
    // itself and would otherwise happily sync another org's mailbox.
    await getBankIntegration(c.get('db'), ctx.orgId, c.req.param('id'));
    const result = await syncIntegration(
      c.get('db'), c.req.param('id'),
      { fetchMessages: fetchMessagesOverImap, key: bankKey() },
      'manual',
    );
    return c.json({ result });
  });

  // ── Transactions (owner-only) ─────────────────────────────────────────────
  r.get('/bank-transactions', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    const status = c.req.query('status');
    const pending = c.req.query('pending') === '1';
    return c.json({
      bankTransactions: await listBankTransactions(c.get('db'), ctx.orgId, {
        status: status ?? undefined, pendingOnly: pending,
      }),
    });
  });

  r.post('/bank-transactions/:id/assign', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    const { contractId } = AssignBody.parse(await c.req.json());
    return c.json({ bankTransaction: await assignBankTransaction(c.get('db'), ctx.orgId, c.req.param('id'), contractId) });
  });

  r.post('/bank-transactions/:id/ignore', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    return c.json({ bankTransaction: await ignoreBankTransaction(c.get('db'), ctx.orgId, c.req.param('id')) });
  });

  r.post('/bank-transactions/:id/reparse', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx); requireOwner(ctx);
    return c.json({ bankTransaction: await reparseBankTransaction(c.get('db'), ctx.orgId, c.req.param('id')) });
  });

  // ── Per-contract rule (normal property access) ────────────────────────────
  r.get('/contracts/:id/payment-rule', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    return c.json(await getPaymentRule(c.get('db'), ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds));
  });

  r.put('/contracts/:id/payment-rule', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    const body = RuleBody.parse(await c.req.json());
    return c.json({ rule: await upsertPaymentRule(c.get('db'), ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds, body) });
  });

  r.delete('/contracts/:id/payment-rule', async (c) => {
    const ctx = getCtx(c); requireOrg(ctx);
    await deletePaymentRule(c.get('db'), ctx.orgId, c.req.param('id'), ctx.allowedPropertyIds);
    return c.body(null, 204);
  });

  return r;
}

/**
 * Vercel Cron endpoint.
 *
 * ⚠️ THE ONE PLACE IN THIS CODEBASE WHERE `orgId` DOES NOT COME FROM `ctx`.
 *
 * Vercel Cron issues an unauthenticated GET with `Authorization: Bearer
 * $CRON_SECRET`, so there is no session and no membership to scope by — the
 * handler iterates every active integration across all orgs and passes each
 * integration's OWN orgId down. That is safe only because the route reads
 * nothing from the request but the secret. Registered BEFORE authMiddleware in
 * server/app.ts; tests/bank-routes.test.ts pins the 401 behaviour, including
 * with CRON_SECRET unset.
 */
export function cronRoutes() {
  const r = new Hono<AppEnv>();

  r.get('/cron/bank-sync', async (c) => {
    const secret = process.env['CRON_SECRET'];
    const header = c.req.header('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    // An unset secret means refuse everything. Running open would be worse than
    // not running: it exposes an endpoint that hits every mailbox in the system.
    if (!secret || presented === '') return c.json({ error: 'unauthorized' }, 401);
    const a = Buffer.from(presented);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: 'unauthorized' }, 401);

    const results = await syncAllActiveIntegrations(c.get('db'), {
      fetchMessages: fetchMessagesOverImap,
      key: loadKey(process.env['SECRET_ENCRYPTION_KEY']),
    });
    return c.json({ results });
  });

  return r;
}
```

- [ ] **Step 4: Mount the routes**

In `server/app.ts`, add to the imports:

```ts
import { bankRoutes, cronRoutes } from './routes/bank.js';
```

Add the cron route **before** the auth gate — immediately after the `authRoutes` line:

```ts
  // Auth routes must remain unauthenticated
  app.route('/api', authRoutes(auth));

  // Cron endpoint: authenticated by CRON_SECRET rather than a session, so it
  // must sit BEFORE the auth middleware. See cronRoutes() for why this is the
  // one place orgId does not come from ctx.
  app.route('/api', cronRoutes());
```

And add the gated route alongside the others, after `paymentBreakdownRoutes()`:

```ts
  app.route('/api', bankRoutes());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/bank-routes.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" pnpm test
pnpm build
git add server/routes/bank.ts server/app.ts tests/bank-routes.test.ts
git commit -m "feat(api): bank integration, transaction inbox and pairing rule endpoints

Integrations and the inbox are owner-only; the per-contract rule follows normal
property access. The manual sync endpoint checks org ownership BEFORE calling
syncIntegration, which resolves orgId from the integration row and would
otherwise sync another org's mailbox.

The cron route is the one place orgId does not come from ctx — it has no
session to scope by. It sits before the auth middleware, compares CRON_SECRET
with timingSafeEqual, and refuses everything when the secret is unset, since an
open endpoint that touches every mailbox is worse than one that never runs.
Tests pin all three 401 paths."
```

---

### Task 12: Cron schedule, environment and deploy docs

**Files:**
- Modify: `vercel.json`
- Modify: `.env.example`
- Modify: `DEPLOY.md`

**Interfaces:** none (configuration only).

- [ ] **Step 1: Add the cron and function duration to `vercel.json`**

Replace the file with:

```jsonc
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm vercel-build",
  "outputDirectory": "dist",
  "framework": "vite",
  "regions": ["fra1"],
  "crons": [
    { "path": "/api/cron/bank-sync", "schedule": "0 5 * * *" }
  ],
  "functions": {
    "api/index.ts": { "maxDuration": 60 }
  },
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Two notes for whoever changes this later: the existing `/api/:path*` rewrite is what lets the cron path reach the single Hono function, so **no new function file is needed**; and on a Hobby plan crons run **once per day** at an approximate time, which is why the schedule is daily. Tightening it to `*/15 * * * *` on Pro is a one-line change and nothing else in the code depends on the cadence.

- [ ] **Step 2: Document the new env vars in `.env.example`**

Append:

```bash
# --- Secret encryption --------------------------------------------------------
# AES-256-GCM key for stored secrets the app must replay (currently the IMAP
# password on bank_integration).
# Generate with: openssl rand -base64 32
# Losing or changing it makes every stored secret undecryptable — for the bank
# integration, the sync then fails loudly with "cannot decrypt IMAP password"
# and each integration needs its password re-entered.
SECRET_ENCRYPTION_KEY=replace-me-with-openssl-rand-base64-32

# Bearer token Vercel Cron presents to GET /api/cron/bank-sync.
# Vercel sets this header automatically once the env var exists on the project.
# When unset, the endpoint refuses every request rather than running open.
CRON_SECRET=replace-me-with-openssl-rand-hex-32
```

- [ ] **Step 3: Document the operational side in `DEPLOY.md`**

Append a new section:

```markdown
## Bankovní integrace (sběr plateb z e-mailů)

### Env vars

| Var | Kde | Jak vyrobit |
|---|---|---|
| `SECRET_ENCRYPTION_KEY` | Vercel project env (all environments) + `.env` lokálně | `openssl rand -base64 32` |
| `CRON_SECRET` | Vercel project env (production) | `openssl rand -hex 32` |

`SECRET_ENCRYPTION_KEY` **musí být stejný ve všech prostředích, která čtou stejnou DB.**
Preview deploymenty mají vlastní Neon branch, takže tam může být jiný — ale integrace
naklonované z produkčních dat pak nepůjdou dešifrovat a sync skončí chybou
„cannot decrypt IMAP password". To je očekávané, ne bug.

### Cron

`vercel.json` → `crons` volá `GET /api/cron/bank-sync` denně v 05:00 UTC. Vercel přidá
hlavičku `Authorization: Bearer $CRON_SECRET` automaticky, jakmile env var na projektu
existuje. **Hobby plán běží 1×/den** v přibližném čase; kratší interval potřebuje Pro
(pak stačí změnit `schedule`).

Cron běží **jen na production deploymentu**, ne na preview.

### Ruční spuštění

- UI: `/settings` → Bankovní integrace → *Synchronizovat*
- API: `POST /api/bank-integrations/:id/sync` (session nebo API token, owner)
- Cron endpoint ručně:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/bank-sync
  ```

### Gmail

IMAP na Gmailu nepřijme běžné heslo — je potřeba **App Password**, což vyžaduje
zapnuté 2FA na Google účtu. Host `imap.gmail.com`, port 993.

### Když sync selže

`Stav` na integraci zčervená a `lastSyncError` řekne proč. Tři typické případy:

| Chyba | Co to znamená |
|---|---|
| `AUTHENTICATIONFAILED` | špatné heslo, nebo běžné heslo místo App Password |
| `cannot decrypt IMAP password` | `SECRET_ENCRYPTION_KEY` se změnil nebo chybí |
| `unexpected_structure: …` | KB změnila šablonu e-mailu — potřeba upravit parser |

U posledního případu zůstane zpráva v inboxu jako `parse_failed` se seznamem
neplatných předpokladů a uloženými `rawTokens`; po opravě parseru jde spustit
*Znovu zpracovat* bez dalšího IMAP dotazu.
```

- [ ] **Step 4: Verify the config parses and commit**

```bash
python3 -c "import json,re,sys; s=open('vercel.json').read(); json.loads(re.sub(r'^\s*//.*$','',s,flags=re.M)); print('vercel.json ok')"
pnpm build
git add vercel.json .env.example DEPLOY.md
git commit -m "chore(deploy): daily cron for bank sync, plus env and runbook

Daily because Hobby crons run once per day; tightening the schedule on Pro is a
one-line change and nothing in the code depends on the cadence. maxDuration 60
gives the IMAP fetch headroom over the 10s default. The existing /api/:path*
rewrite means the cron path needs no new function file.

DEPLOY.md documents the three failure modes that actually happen, including
that a preview with a different SECRET_ENCRYPTION_KEY cannot decrypt cloned
production integrations — expected, not a bug."
```

---

### Task 13: MCP tools

**Files:**
- Create: `mcp/tools/bank.ts`
- Modify: `mcp/index.ts` — register the tools
- Test: extend `tests/mcp-tools-smoke.test.ts`

**Interfaces:**
- Consumes: `RantalApiClient` — check the exact exported name in `mcp/client.ts` before writing (it is `RentalApiClient` in the existing tools).
- Produces: the eight tools listed in the table below (the spec's original seven, plus `bank_integrations_setup_url`, added during the design review).

- [ ] **Step 1: Read the existing registration to match it**

```bash
cat mcp/index.ts
grep -n "RENTAL_API_URL\|apiUrl\|baseUrl" mcp/client.ts
```

- [ ] **Step 2: Write the tools**

Create `mcp/tools/bank.ts`:

```ts
import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type { RentalApiClient } from '../client.js';

const Haler = z.number().int();

const Empty = z.object({});
const IntegrationId = z.object({ id: z.string().describe('Bank integration ID') });
const ListTransactions = z.object({
  status: z.enum(['unmatched', 'matched', 'ambiguous', 'suspected_duplicate', 'ignored', 'parse_failed']).optional(),
  pending: z.boolean().optional().describe('Only transactions still waiting for a payment (paymentId is null and not ignored)'),
});
const AssignTransaction = z.object({
  id: z.string().describe('Bank transaction ID'),
  contractId: z.string(),
});
const ContractId = z.object({ contractId: z.string() });
const SetRule = z.object({
  contractId: z.string(),
  counterpartyAccount: z.string().nullable().optional().describe("Payer's account, e.g. '294153028/0300'. null = any. The prefix is significant: '123-294153028/0300' is a different account."),
  vs: z.string().nullable().optional().describe('Variabilní symbol; null = any'),
  ks: z.string().nullable().optional().describe('Konstantní symbol; null = any'),
  ss: z.string().nullable().optional().describe('Specifický symbol; null = any'),
  amountFrom: Haler.nullable().optional().describe('Inclusive lower bound in haléře (CZK × 100)'),
  amountTo: Haler.nullable().optional().describe('Inclusive upper bound in haléře (CZK × 100)'),
  active: z.boolean().optional(),
});

export function addBankTools(server: FastMCP, client: RentalApiClient) {
  server.addTool({
    name: 'bank_integrations_list',
    description: 'List the org\'s bank integrations (IMAP mailboxes harvested for incoming-payment notifications), including each one\'s last sync status. Never returns credentials.',
    parameters: Empty,
    execute: async () => JSON.stringify(
      (await client.get<{ bankIntegrations: unknown[] }>('/api/bank-integrations')).bankIntegrations, null, 2),
  });

  server.addTool({
    name: 'bank_integrations_setup_url',
    description: 'Get a link the user can open to add a new bank integration in the web app. Use this when asked to add or connect a bank/mailbox: creating one requires an IMAP password, which must be typed into the app directly rather than passed through a tool call.',
    parameters: Empty,
    execute: async () => JSON.stringify({
      url: `${client.baseUrl.replace(/\/$/, '')}/settings?tab=bank&action=new`,
      note: 'Open this and fill in the IMAP details. Gmail needs an App Password (requires 2FA), not the account password.',
    }, null, 2),
  });

  server.addTool({
    name: 'bank_integrations_sync',
    description: 'Run an integration\'s IMAP sync now instead of waiting for the daily cron. Returns counters: fetched, created, matched, failed.',
    parameters: IntegrationId,
    execute: async (args) => JSON.stringify(
      (await client.post<{ result: unknown }>(`/api/bank-integrations/${args.id}/sync`, {})).result, null, 2),
  });

  server.addTool({
    name: 'bank_transactions_list',
    description: 'List parsed incoming bank transactions. Use pending:true to see only those still needing attention — unmatched, ambiguous, suspected duplicates, and parse failures.',
    parameters: ListTransactions,
    execute: async (args) => {
      const qs = new URLSearchParams();
      if (args.status) qs.set('status', args.status);
      if (args.pending) qs.set('pending', '1');
      const suffix = qs.toString() ? `?${qs}` : '';
      return JSON.stringify(
        (await client.get<{ bankTransactions: unknown[] }>(`/api/bank-transactions${suffix}`)).bankTransactions, null, 2);
    },
  });

  server.addTool({
    name: 'bank_transactions_assign',
    description: 'Pair a bank transaction to a contract, creating the payment. Also the way to confirm a suspected_duplicate is genuinely a separate payment.',
    parameters: AssignTransaction,
    execute: async (args) => JSON.stringify(
      (await client.post<{ bankTransaction: unknown }>(`/api/bank-transactions/${args.id}/assign`, { contractId: args.contractId })).bankTransaction, null, 2),
  });

  server.addTool({
    name: 'bank_transactions_ignore',
    description: 'Mark a bank transaction as not relevant (bank noise, a refund, an unrelated transfer). Creates no payment and removes it from the pending list.',
    parameters: z.object({ id: z.string().describe('Bank transaction ID') }),
    execute: async (args) => JSON.stringify(
      (await client.post<{ bankTransaction: unknown }>(`/api/bank-transactions/${args.id}/ignore`, {})).bankTransaction, null, 2),
  });

  server.addTool({
    name: 'payment_rule_get',
    description: 'Read a contract\'s payment-pairing rule plus the derived pairing health (nenastaveno / ok / chyba).',
    parameters: ContractId,
    execute: async (args) => JSON.stringify(
      await client.get<unknown>(`/api/contracts/${args.contractId}/payment-rule`), null, 2),
  });

  server.addTool({
    name: 'payment_rule_set',
    description: 'Create or replace a contract\'s payment-pairing rule. PUT semantics: omitted criteria become null ("any"), they are NOT merged with the existing rule. A rule must have at least one criterion.',
    parameters: SetRule,
    execute: async (args) => {
      const { contractId, ...body } = args;
      return JSON.stringify(
        (await client.put<{ rule: unknown }>(`/api/contracts/${contractId}/payment-rule`, body)).rule, null, 2);
    },
  });
}
```

- [ ] **Step 3: Add `put` to the MCP client**

`mcp/client.ts` has `get`/`post`/`patch`/`delete` but **no `put`**, which `payment_rule_set` needs. `baseUrl` is already `public readonly`, so the setup-url tool can use it as-is.

Add this method to `RentalApiClient`, after `patch`:

```ts
  put<T>(path: string, body: unknown): Promise<T> {
    return this.req<T>('PUT', path, body);
  }
```

- [ ] **Step 4: Register in `mcp/index.ts`**

Add the import and the registration call alongside the existing `add*Tools(server, client)` lines:

```ts
import { addBankTools } from './tools/bank.js';
// …
addBankTools(server, client);
```

- [ ] **Step 5: Extend the smoke test**

`tests/mcp-tools-smoke.test.ts` does **not** assert on a list of tool names — it imports each tool's exported function and calls it against a real app through a `RentalApiClient` built on an API token. So extend it the same way, with real calls rather than name assertions:

- `bankIntegrationsList` — returns `[]` for a fresh org.
- `bankTransactionsList` — returns `[]`, and with `{ pending: true }` too.
- `paymentRuleSet` then `paymentRuleGet` on a seeded contract — a genuine round-trip, asserting the criteria come back and `health.state` is `'nenastaveno'` (no integration exists in the smoke fixture).
- `bankIntegrationsSetupUrl` — asserts the URL ends in `/settings?tab=bank&action=new`.

Deliberately **not** smoke-tested, because MCP cannot create the prerequisite rows and seeding them adds no coverage of the tool layer: `bankIntegrationsSync`, `bankTransactionsAssign`, `bankTransactionsIgnore`. Those are covered by Task 11's route tests, which is the layer where the behaviour actually lives.

- [ ] **Step 6: Run the suite, typecheck, commit**

```bash
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" pnpm test
pnpm build
git add mcp/tools/bank.ts mcp/index.ts mcp/client.ts tests/mcp-tools-smoke.test.ts
git commit -m "feat(mcp): bank integration and transaction tools

Integration create/update/delete are deliberately absent: they carry a
credential and a stdio agent is the wrong place to handle one. Instead
bank_integrations_setup_url returns a deep link into the app, so an agent asked
to 'add a bank integration' can complete the request usefully without a
password ever passing through a tool call."
```

---

## Plan 2 Definition of Done

- [ ] `TEST_DATABASE_URL=… pnpm test` green, including `tests/reference-property-2024.test.ts`
- [ ] `pnpm build` clean
- [ ] No test opens a network socket (`fakeImap` everywhere; `imapflow` appears only in `core/lib/imap-fetcher.ts`)
- [ ] `grep -rn "imapPasswordEnc" server/ src/` returns nothing
- [ ] The cron endpoint 401s with a missing, empty, wrong, and unset-secret request
- [ ] Eight commits on `feat/bank-payment-pairing`

**Next:** `docs/superpowers/plans/2026-08-20-bank-pairing-plan-3-ui.md`
