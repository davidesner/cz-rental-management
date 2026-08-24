# Automatic collection and pairing of incoming payments

Design spec — 2026-08-20

Collect incoming-payment notification e-mails from Komerční banka over IMAP, parse
them into structured bank transactions, and automatically create and pair `payment`
rows to contracts using a per-contract matching rule. Runs on a Vercel cron and can
be triggered manually.

## Scope

**In scope**

- A `bank_integration` resource (org-scoped, multiple per org) describing one IMAP
  mailbox to harvest, configured from a general settings page.
- Parsing the KB *"Servisní zpráva: Přijali jsme platbu na Váš účet"* HTML notification.
- A `bank_transaction` staging table holding every parsed notification verbatim.
- One `payment_matching_rule` per contract; on a unique match the sync creates the
  `payment` row and links it.
- An inbox on the settings page for transactions that matched nothing, matched
  several contracts, or failed to parse.
- A "Párování plateb" card on the pronájem detail page, per the mockup.
- Scheduled execution via Vercel cron plus a manual "Sync now" and a
  "Test connection" action.
- MCP tools for the read/assign surface.

**Explicitly out of scope**

- Real bank APIs (KB API, PSD2/AISP). The `kind` discriminator leaves room; nothing
  more is built now.
- Outgoing payments and account-balance tracking.
- Attachment handling and PDF statement parsing.
- Multi-currency: non-CZK notifications are recorded and ignored, never converted.
- More than one matching rule per contract.
- Encryption-key rotation tooling.
- Notifications to the user (e-mail/push) about sync failures — the UI status pill
  is the only surface.

## Decisions already taken

| Question | Decision | Rationale |
|---|---|---|
| Where the sync runs | Vercel Cron → authenticated API endpoint | Single platform; the existing `/api/:path*` rewrite means no new function file. |
| Relationship to `payment` | Staging table, `payment` created only on a rule match | Keeps bank noise out of the ledger; allows re-parse and re-run without mutating payments; never invents a payment. |
| IMAP secret storage | AES-256-GCM ciphertext in Postgres, key from env | Self-service integration management with no redeploy. |
| Config validation | A "Test connection" endpoint | Validate interactively instead of debugging a silent cron failure. |
| Rule cardinality | Exactly one rule per contract | Matches the mockup; simplest UI and matching semantics. YAGNI on rule lists. |
| Meaning of "Stav" | Operational health of the integration | Grey *Nenastaveno* when unconfigured, green *Vše v pořádku* on a clean last run, red with the error on failure. |
| Where unmatched land | Inbox on the settings page | Bank plumbing stays in one place, out of the payments ledger. |
| Resent notifications | Held in the inbox as `suspected_duplicate`, never auto-paired and never auto-discarded | No payment is created, so the double-count is prevented; the row survives because silently dropping a genuine second identical transfer would lose real money. |

## Evidence: what the KB notification actually contains

Analysed from a real notification (`Servisní zpráva: Přijali jsme platbu na Váš účet`,
`From: Komerční banka <servis@kbinfo.cz>`, `Reply-To: kbplus@kb.cz`).

**Structure.** A single `text/html` MIME part, `quoted-printable`, UTF-8. No plain-text
alternative. The payment fields sit in a flat, ordered sequence of `<span>` elements
where each label span is immediately followed by its value span:

```
 0  'For English scroll down'
 1  'Přijali jsme platbu 30,00 Kč na Váš účet'
 2  'Splatnost: 20. 08. 2026'
 3  'Z účtu'                     4  '123-<redacted>/0100'
 5  'Na účet'                    6  '123-<redacted>/0100'
 7  'Zpráva pro příjemce'        8  ''
 9  'Variabilní symbol'         10  ''
11  'Konstantní symbol'         12  ''
13  'Specifický symbol'         14  ''
15  'Chcete s něčím poradit?'
16  'We have received the payment 30.00 CZK to your account'
17  'Due date: 08-20-2026'
18  'From account'              19  '123-<redacted>/0100'
20  'To account'                21  '123-<redacted>/0100'
...
```

**Consequences for the design**

1. **Values can be empty.** All four symbol fields and the message were empty in the
   sample. A naive "next non-empty text after the label" parse would read the
   *following label* as the value. Parsing must be positional: value = the span
   immediately after the label span, empty string included.

   An empty value is therefore indistinguishable from a *missing* one by content
   alone, which makes **structural validation mandatory** rather than a nicety: the
   parser asserts that the expected label set is present, in the expected order,
   before it reads any value. See
   [Structural validation](#structural-validation-of-the-notification) — a notification
   whose shape has drifted must produce a loud, visible failure, never a
   half-populated transaction.
2. **There is no bank transaction ID.** Idempotency has to key off the e-mail's
   `Message-ID` header.
3. **There is no counterparty name** — only account numbers. So pairing must work on
   account number plus symbols plus an amount band, which is exactly what the mockup
   encodes. The created payment's `counterparty` stays null.
4. **Every field is mirrored in English** with a different amount and date format
   (`30.00 CZK`, `08-20-2026` = MM-DD-YYYY). This is a free correctness check: if the
   Czech and English halves disagree on amount or date, refuse to parse.
5. **Account format is `prefix-number/bankcode`** (`123-0000000000/0100`) — that is the
   full form. **When an account has no prefix, the notification prints it without
   one**, exactly as the mockup rule shows it (`294153028/0300`). So both forms occur
   in real mail and on both sides of a comparison, and the prefix is *significant*:
   an account with a prefix and one without are different accounts, not two spellings
   of the same one. See [Account normalization](#account-normalization).
6. **The "Zobrazit online" link is a click-tracker** (`link.kbinfo.cz/f/a/…`), not the
   CloudFront page directly. We store the href as a source link but **never fetch it** —
   following it registers a click and the target may be single-use.

## Data model

Four new tables. Money stays integer haléře; dates use Drizzle `date({ mode: 'string' })`
like the rest of the schema.

### `bank_integration`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | cuid2 |
| `orgId` | text → `organization.id` cascade | |
| `kind` | text enum `['kb_email']` | discriminator; selects the parser |
| `name` | text not null | e.g. "KB — notifikace" |
| `imapHost` | text not null | e.g. `imap.gmail.com` |
| `imapPort` | integer not null default 993 | |
| `imapUser` | text not null | |
| `imapPasswordEnc` | text not null | AES-256-GCM ciphertext, never returned by the API |
| `imapFolder` | text not null default `'INBOX'` | |
| `fromFilter` | text not null default `'servis@kbinfo.cz'` | |
| `subjectFilter` | text not null default `'Přijali jsme platbu'` | substring, case-insensitive |
| `accountNumber` | text nullable | *your* account; when set, notifications addressed elsewhere are ignored |
| `active` | boolean not null default true | |
| `uidValidity` | bigint nullable | IMAP cursor |
| `lastUid` | bigint nullable | IMAP cursor |
| `lastSyncAt` | timestamptz nullable | |
| `lastSyncStatus` | text enum `['ok','error']` nullable | drives the "Stav" pill |
| `lastSyncError` | text nullable | |
| `createdAt` | timestamptz default now | |

### `bank_transaction`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `orgId` | text → `organization.id` cascade | |
| `integrationId` | text → `bank_integration.id` cascade | |
| `messageId` | text not null | e-mail `Message-ID`; **unique index on (`orgId`,`messageId`)** |
| `amount` | integer not null | haléře |
| `currency` | text not null | `'CZK'` for anything we act on |
| `valueDate` | date not null | from *Splatnost* |
| `fromAccount` | text nullable | normalized |
| `toAccount` | text nullable | normalized |
| `vs`, `ks`, `ss` | text nullable | null when the field was empty |
| `messageForRecipient` | text nullable | |
| `sourceLink` | text nullable | the `link.kbinfo.cz` href; never fetched by us |
| `rawTokens` | jsonb nullable | the ordered span array (~1 KB), enough to re-parse |
| `status` | text enum | `unmatched \| matched \| ambiguous \| suspected_duplicate \| ignored \| parse_failed` |
| `statusReason` | text nullable | e.g. `foreign_account`, `unsupported_currency`, a parse reason code, or the failed-assertion list |
| `duplicateOfTransactionId` | text → `bank_transaction.id` set null, nullable | set when `status='suspected_duplicate'` |
| `matchedBy` | text enum `['rule','manual']` nullable | |
| `paymentId` | text → `payment.id` **ON DELETE SET NULL** nullable | |
| `receivedAt` | timestamptz not null | e-mail `Date` header |
| `createdAt` | timestamptz default now | |

> **`paymentId IS NULL` is the source of truth for "needs attention",** not `status`.
> If the user deletes a created payment, the FK nulls out but no trigger can rewrite
> `status`. The inbox query is therefore
> `WHERE paymentId IS NULL AND status <> 'ignored'`, and `status` is advisory metadata.

### `payment_matching_rule`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `orgId` | text → `organization.id` cascade | |
| `contractId` | text → `contract.id` cascade | **unique** — 1:1 with the contract |
| `counterpartyAccount` | text nullable | null = *cokoliv* |
| `vs`, `ks`, `ss` | text nullable | null = *cokoliv* |
| `amountFrom` | integer nullable | haléře, inclusive |
| `amountTo` | integer nullable | haléře, inclusive |
| `active` | boolean not null default true | |
| `createdAt`, `updatedAt` | timestamptz | |

### `bank_sync_run`

A short log so a cron you cannot watch is still debuggable.

| Column | Type |
|---|---|
| `id` | text PK |
| `integrationId` | text → `bank_integration.id` cascade |
| `trigger` | text enum `['cron','manual']` |
| `startedAt`, `finishedAt` | timestamptz |
| `status` | text enum `['ok','error']` |
| `fetched`, `created`, `matched`, `failed` | integer counters |
| `error` | text nullable — on a parse failure, the raw HTML capped at 200 KB |

### What does *not* change

`payment` keeps its current schema. VS/KS/SS live on `bank_transaction`. A payment
created by the sync gets:

| `payment` field | Value |
|---|---|
| `source` | `'bank'` |
| `externalId` | `kbemail:<messageId>` — the existing unique `(orgId, externalId)` index becomes a second idempotency guard |
| `contractId` | the matched contract |
| `amount` | transaction amount, haléře |
| `paidAt` | `valueDate` (*Splatnost*) |
| `counterpartyAccount` | `fromAccount` |
| `counterparty` | `null` — the notification carries no payer name |
| `statementRef` | `sourceLink` |
| `description` | `messageForRecipient`, else a compact `VS/KS/SS` summary |

## Access control

Per `CLAUDE.md`, every service function takes `orgId` + `allowedPropertyIds` from
`ctx`. Two rules on top:

- **Bank integrations and the inbox are owner-only** (`ctx.role === 'owner'`). A member
  restricted to one property must not see org-wide bank traffic — an unassigned
  transaction is, by definition, not yet attributable to a property.
- **The per-contract rule follows normal property access** — reading or writing it
  requires access to the contract's property, checked the same way
  `rent-reduction.ts` does it.

> **The cron endpoint is the one place in the codebase where `orgId` does not come
> from `ctx`.** It iterates every active integration across all orgs, so it must pass
> each integration's own `orgId` explicitly and `allowedPropertyIds = null`. This is a
> deliberate, isolated exception to the multi-tenant rule and needs a comment saying
> so at the call site, plus a test that the endpoint is unreachable without the secret.

## Module layout

Business logic is pure and framework-free; routes are thin shells.

```
core/lib/kb-email-parser.ts     pure: raw email Buffer → ParsedNotification
core/lib/payment-pairing.ts     pure: transaction + rules → MatchResult
core/lib/account-number.ts      pure: Czech account normalization
core/lib/crypto-box.ts          pure: AES-256-GCM seal/open
core/lib/imap-fetcher.ts        I/O only (imapflow), injected into the service
core/services/bank-integration.ts   CRUD, test-connection, sync orchestration
core/services/bank-transaction.ts   inbox list / assign / ignore / reparse
core/services/payment-rule.ts       get / upsert / delete the per-contract rule
server/routes/bank.ts               /api/bank-integrations/*, /api/bank-transactions/*
server/routes/cron.ts               GET /api/cron/bank-sync (pre-auth, CRON_SECRET)
mcp/tools/bank.ts                   MCP tools
src/pages/Settings.tsx              tabbed settings shell
src/pages/settings/BankTab.tsx      integrations + inbox
```

**New dependencies:** `imapflow` (1.7.1, MIT), `mailparser` (3.9.15, MIT),
`node-html-parser` (9.0.1, MIT).

No provider plugin framework. `kind` has one value and the parser is chosen by a
`switch`; a second bank is a new file plus a case.

## Parsing

`parseKbPaymentNotification(raw: Buffer): ParsedNotification` — pure, no I/O.

1. `mailparser` decodes MIME, quoted-printable and charset, yielding headers and the
   HTML body.
2. Reject early unless `From` contains the integration's `fromFilter` and `Subject`
   contains `subjectFilter` (case- and diacritic-insensitive) → reason
   `not_kb_notification`.
3. `node-html-parser` parses the body; `querySelectorAll('span')` gives spans in
   document order. Collect `.text`, normalise whitespace (including NBSP, zero-width
   joiners and the soft-hyphen padding KB injects), and keep empty strings.
4. Read the Czech block by label position: `Z účtu`, `Na účet`,
   `Zpráva pro příjemce`, `Variabilní symbol`, `Konstantní symbol`,
   `Specifický symbol`. Value = the next span. Empty string → `null`.
5. Amount and currency from the headline span
   (`Přijali jsme platbu 35 000,00 Kč na Váš účet`): strip NBSP thousands separators,
   comma is the decimal mark, result in haléře. Date from
   `Splatnost: 20. 08. 2026` → `2026-08-20`.
6. Read the English block the same way and **cross-check amount and value date**.
   Mismatch → reason `cz_en_mismatch`, refuse.
7. Extract the "Zobrazit online" href as `sourceLink`.

**Failure is explicit, never silent.** The function returns a discriminated union
`{ ok: true, value } | { ok: false, reason }` with reason codes
`not_kb_notification`, `unexpected_structure`, `missing_amount`, `missing_value_date`,
`missing_to_account`, `cz_en_mismatch`, `unsupported_currency`. Anything that fails
becomes a `bank_transaction` with `status = 'parse_failed'` — visible in the inbox,
with the `rawTokens` retained and a "Znovu zpracovat" action, so a KB template change
is a fixable parser bug rather than lost money.

### Structural validation of the notification

Because an empty value and a missing value look identical once read, the parser
validates the *shape* of the mail before trusting any value. This runs as step 3.5,
between collecting the spans and reading them.

**The assertions**

1. Every expected Czech label is present exactly once: `Z účtu`, `Na účet`,
   `Zpráva pro příjemce`, `Variabilní symbol`, `Konstantní symbol`,
   `Specifický symbol`.
2. They appear in the expected relative order.
3. Each label is followed by at least one further span — the slot its value occupies.
4. The headline span matches the amount pattern, and the `Splatnost` span matches the
   date pattern.
5. The English mirror block is present and carries the same field count.

Any assertion failing means the template changed. The parser returns
`unexpected_structure` **with the list of assertions that failed**, and the raw HTML
is retained (capped at 200 KB) in `bank_sync_run.error` — the one case where we keep
the full body rather than just `rawTokens`, because tokenization itself is what broke.

**How it surfaces.** A structural failure is not a quiet counter:

- The transaction is stored with `status='parse_failed'` and the failed-assertion list
  in `statusReason`, so it appears in the inbox rather than vanishing.
- The run finishes with `lastSyncStatus='error'` and `lastSyncError` naming the
  template drift. That turns the integration's **Stav** pill **red** on both the
  settings page and every affected pronájem detail — a structural change gets the same
  visibility as a failed login, because it has the same consequence: payments stop
  being collected.
- Reason codes are deliberately distinguishable so `unexpected_structure` (our parser
  needs updating) reads differently from `not_kb_notification` (unrelated mail, benign)
  in the UI. Only the former escalates the integration to `error`; a stray unrelated
  e-mail must never turn the pill red.

### Account normalization

A Czech account number is `[prefix-]number/bankCode`, and both the notification and
the rule may or may not carry the prefix.

- Split into optional `prefix-`, `number`, `/bankCode`.
- Strip leading zeros from the prefix and from the number.
- An **all-zero prefix normalizes to absent** (`000-123456/0100` → `123456/0100`), since
  that is the same account written two ways.
- Bank code is kept as four digits.
- Unparseable input is kept verbatim and only ever equals an identically verbatim value.

**The prefix is significant.** `123-294153028/0300` and `294153028/0300` are *different
accounts*, and normalization does not collapse them. A rule entered without a prefix
will therefore not match a transaction that has one — which is the single most likely
way to misconfigure this.

Two cheap guards against exactly that mistake:

- The rule edit dialog normalizes what you type and shows the canonical form back, so a
  mismatch in shape is visible while you are entering it.
- When an unmatched transaction differs from some contract's rule **only** by the
  prefix, the inbox row shows a near-miss hint: *"blízko pravidlu pro `<pronájem>` —
  liší se pouze předčíslím"*, with a one-click assign. The rule is not silently
  loosened; you are told where to fix it.

Symbols (VS/KS/SS) are compared with leading zeros stripped, so `0123` matches `123`.

## IMAP fetch

`core/lib/imap-fetcher.ts` is the only file doing network I/O for this feature. The
service depends on the interface, not the implementation:

```ts
type FetchMessages = (cfg: ImapConfig, cursor: Cursor, limit: number)
  => Promise<{ messages: RawMessage[]; cursor: Cursor }>;
```

- `imapflow` over TLS on 993. The mailbox is opened **read-only**; we never mark
  messages seen, move them, or delete them.
- **Incremental cursor is UID-based**: store `uidValidity` + `lastUid`, and search
  `{ uid: '<lastUid+1>:*' }`. If the server reports a different `uidValidity`
  (mailbox rebuilt), fall back to a `SINCE <lastSyncAt - 7 days>` search and re-derive
  the cursor. Idempotency on `messageId` makes that overlap harmless.
- Sender/subject filtering happens **in code, not in IMAP SEARCH** — the subject
  contains diacritics and IMAP charset handling across servers is inconsistent.
- `MAX_MESSAGES_PER_RUN = 25`, oldest UID first. The cursor advances only across the
  contiguous processed prefix, so an interrupted run resumes rather than skipping.
- A soft deadline (stop fetching at ~10 s before `maxDuration`) bounds the run inside
  the serverless timeout. Whatever was processed is committed and the cursor saved.

## Sync orchestration

`syncIntegration(db, orgId, integrationId, { fetchMessages, trigger })`:

1. Open a `bank_sync_run` row.
2. Decrypt `imapPasswordEnc`. A missing or malformed `SECRET_ENCRYPTION_KEY` fails the run
   loudly with a distinct error rather than attempting a connection.
3. Fetch up to `MAX_MESSAGES_PER_RUN` messages from the cursor.
4. For each message, **in its own DB transaction**:
   - Skip if `(orgId, messageId)` already exists — idempotent by construction.
   - Parse. On failure insert `status='parse_failed'` with the reason and continue.
   - If `integration.accountNumber` is set and `toAccount` differs →
     `status='ignored'`, `statusReason='foreign_account'`.
   - If `currency !== 'CZK'` → `status='ignored'`,
     `statusReason='unsupported_currency'`.
   - Otherwise evaluate the rules (below). On a unique match, insert the
     `bank_transaction` **and** the `payment` together, `status='matched'`,
     `matchedBy='rule'`.
5. Save the cursor, `lastSyncAt`, `lastSyncStatus`, `lastSyncError`, and close the run
   row with counters.

A parse failure never blocks the cursor — otherwise one malformed e-mail wedges the
integration forever. The record is kept instead, so nothing is lost.

## Matching semantics

`matchTransaction(tx, rules): { kind: 'none' } | { kind: 'one', contractId } | { kind: 'many', contractIds }`

**Candidate rules** are the active rules of contracts in the same org **whose contract
was active on `valueDate`** (`startDate <= valueDate` and
`endDate IS NULL OR valueDate <= endDate`). This stops an ended lease's stale rule from
stealing a new tenant's payment.

**A rule matches when every non-null criterion holds:**

| Criterion | Comparison |
|---|---|
| `counterpartyAccount` | normalized equality against `fromAccount` |
| `vs` / `ks` / `ss` | leading-zero-stripped string equality |
| `amountFrom` | `tx.amount >= amountFrom` |
| `amountTo` | `tx.amount <= amountTo` |

A null criterion is *cokoliv* and always passes.

**Outcomes**

- **0 matches** → `status='unmatched'`, no payment. Sits in the inbox.
- **1 match** → the duplicate guard below runs; if it passes, payment created,
  `status='matched'`, `matchedBy='rule'`.
- **2+ matches** → `status='ambiguous'`, **no payment created**, the candidate contract
  ids recorded in `statusReason` so the inbox can offer them as one-click choices.

### Duplicate guard

`Message-ID` uniqueness stops the *same e-mail* being imported twice, but not a
notification KB **re-sends** for a payment already collected — a different
`Message-ID` describing the same money. Without a second guard that silently doubles a
month's rent.

Before creating a payment for a uniquely-matched transaction, look for an existing
`bank_transaction` in the same org that

- has a **non-null `paymentId`** (so it really did produce a payment),
- has a different `messageId`, and
- has an identical **fingerprint**: same `fromAccount`, `toAccount`, `amount`,
  `valueDate`, `vs`, `ks`, `ss`.

If one exists, **no payment is created**. The new transaction is stored with
`status='suspected_duplicate'` and `duplicateOfTransactionId` pointing at the original.

**It is held, not discarded** — decided, not optional. Two genuinely identical transfers
on the same day with the same symbols are possible: rare, but real, and dropping one
would silently lose a tenant's money, which is strictly worse than the double-count we
are preventing. So the row stays in the inbox with both sides shown side by side and a
single *"Není duplikát — spárovat"* action that creates the payment as a manual
assignment. Nothing is auto-created and nothing is auto-destroyed; the ambiguity is
handed to the only party who can actually resolve it.

Reusing the existing `POST /api/bank-transactions/:id/assign` for that confirmation
means no extra endpoint — a confirmed duplicate is just a manual assignment.

To make that judgement possible without leaving the page, the inbox row also shows
whether the target month is **already fully covered** by existing payments — read from
the existing payment-breakdown computation, not recomputed here. A duplicate landing on
a fully-paid month is almost certainly a resend; one landing on a month still short is
much more likely to be a real second transfer. This is displayed as context; it is
never load-bearing, and it does not gate the action either way.

**A rule with no criteria at all is rejected at write time** (`validation` error:
"pravidlo musí mít alespoň jedno kritérium"). Otherwise it would match every incoming
transaction in the org.

**Manual assignment from the inbox** creates the payment exactly as a rule match
would, with `matchedBy='manual'`. **Ignoring** sets `status='ignored'` and creates
nothing. Neither action mutates the rule — a recurring mis-pair is fixed by editing
the rule, not by re-assigning every month.

## "Stav" — pairing health

Derived on read, never stored. Returned alongside the rule from
`GET /api/contracts/:id/payment-rule`:

| Condition | State | Rendering |
|---|---|---|
| No active integration in the org, or no rule, or rule inactive | `nenastaveno` | grey — "Nenastaveno" |
| Newest integration's `lastSyncStatus = 'error'` | `chyba` | red — "Chyba: `<lastSyncError>`" |
| Otherwise | `ok` | green — "Vše v pořádku", with the last-sync timestamp |

## API surface

Owner-only unless noted. The IMAP password is **write-only**: responses carry
`imapPasswordSet: boolean`, never the value or the ciphertext.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/bank-integrations` | list |
| `POST` | `/api/bank-integrations` | create |
| `PATCH` | `/api/bank-integrations/:id` | update; omitted password leaves it unchanged |
| `DELETE` | `/api/bank-integrations/:id` | delete |
| `POST` | `/api/bank-integrations/:id/test` | connect, count matching messages, import nothing |
| `POST` | `/api/bank-integrations/:id/sync` | run now |
| `GET` | `/api/bank-transactions?status=…` | inbox |
| `POST` | `/api/bank-transactions/:id/assign` | `{ contractId }` → create + link payment |
| `POST` | `/api/bank-transactions/:id/ignore` | |
| `POST` | `/api/bank-transactions/:id/reparse` | re-run the parser over `rawTokens` |
| `GET` | `/api/contracts/:id/payment-rule` | rule + derived health (property access) |
| `PUT` | `/api/contracts/:id/payment-rule` | upsert (property access) |
| `DELETE` | `/api/contracts/:id/payment-rule` | (property access) |
| `GET` | `/api/cron/bank-sync` | **pre-auth**, `CRON_SECRET` bearer, all orgs |

## Cron and configuration

`vercel.json` gains:

```jsonc
"crons": [
  { "path": "/api/cron/bank-sync", "schedule": "0 5 * * *" }
],
"functions": {
  "api/index.ts": { "maxDuration": 60 }
}
```

- Vercel Cron issues a **GET** with `Authorization: Bearer $CRON_SECRET`. The route is
  registered **before** `authMiddleware` — same position as `authRoutes` — and compares
  the secret with `crypto.timingSafeEqual`. A missing `CRON_SECRET` env var means the
  endpoint refuses every request rather than running open.
- The existing `/api/:path*` → `/api` rewrite means no new function file.
- **Hobby plans allow one cron run per day** at approximate times. Daily is a fine
  cadence for monthly rent; the manual "Sync now" button covers urgency. Moving to a
  tighter schedule is a one-line change to `schedule` on a Pro plan.

**New environment variables** (`.env.example`, `DEPLOY.md`, Vercel project settings):

| Variable | Purpose |
|---|---|
| `SECRET_ENCRYPTION_KEY` | 32 random bytes, base64 — AES-256-GCM key for stored secrets the app must replay (currently IMAP passwords) |
| `CRON_SECRET` | Vercel cron bearer token |

## Encryption

`core/lib/crypto-box.ts`, using `node:crypto` only:

- AES-256-GCM, key = `base64decode(SECRET_ENCRYPTION_KEY)`, rejected unless exactly 32 bytes.
- A fresh random 12-byte IV per record; stored as `v1:<iv>:<tag>:<ciphertext>`,
  base64url, so a future scheme can coexist behind the version tag.
- `open()` throws on any auth-tag mismatch — a tampered or key-mismatched row fails
  loudly instead of yielding garbage.
- Key rotation is out of scope; the version prefix is what makes it addable later.

## UI

The nav currently links straight to `/settings/api-tokens`. Since the request is for a
**general settings page**, replace that with a single **"Nastavení"** entry pointing at
`/settings`, a tabbed shell:

- **Bankovní integrace** — the integration list and the inbox.
- **API tokeny** — the existing `ApiTokens` page content, moved in unchanged.

`/settings/api-tokens` keeps working as a redirect to `/settings?tab=api-tokens` so
existing links and bookmarks don't break.

### Bankovní integrace tab

**Integration list** — one row per integration: name, host/user, status pill (the same
three states as "Stav"), last sync time, and actions *Test připojení*, *Synchronizovat*,
*Upravit*, *Smazat*. The add/edit dialog collects host, port, user, password, folder,
sender filter, subject filter and your own account number. The password field shows
`•••• nastaveno` when set and only sends a value when actually retyped. It opens
automatically when the page is loaded with `?action=new`, which is what the
`bank_integrations_setup_url` MCP tool links to.

**Help text under the password field is required, not optional:** most users will point
this at Gmail, where a plain account password does not work — IMAP needs an
*App Password*, which in turn requires 2FA on the Google account. The dialog says so
inline, with a link to Google's App Password page, next to the password input. Getting
this wrong produces an authentication error that looks like a wrong password, so the
explanation belongs where the mistake is made rather than in a doc.

**Inbox: "Nepřiřazené platby"** — the transactions where `paymentId IS NULL AND status
<> 'ignored'`, newest first: value date, amount, from-account, VS, message, status. Per
row: a *Přiřadit k pronájmu* contract dropdown and *Ignorovat*, plus per status:

| Status | Row shows |
|---|---|
| `unmatched` | the near-miss hint when a rule differs only by account prefix |
| `ambiguous` | the candidate contracts as direct one-click buttons |
| `suspected_duplicate` | the original transaction and its payment side by side, whether the target month is already fully covered, and a single *"Není duplikát — spárovat"* action |
| `parse_failed` | the reason code and failed assertions, plus *Znovu zpracovat* |

A `parse_failed` row carrying `unexpected_structure` also renders a page-level warning
banner — that state means collection is broken for everyone, not just for this one
message.

### Pronájem detail — "Párování plateb" card

A new `Card` in the **Přehled** tab, following the mockup: first row **Stav**,
**Částka od**, **Částka do**; second row **Číslo účtu**, **Variabilní symbol**,
**Specifický symbol**, **Konstantní symbol**. Null criteria render as *cokoliv*. A
pencil button opens the edit dialog, styled like the existing `EditPodminkyDialog`.

When creating a rule for a contract that has none, the amount band is **prefilled from
the contract's current expected monthly total ±10 %**, rounded to whole korun — the
number the page already computes as `monthlyTotal`. It stays fully editable.

## MCP tools

`mcp/tools/bank.ts`, following the one-tool-per-operation convention:

| Tool | Purpose |
|---|---|
| `bank_integrations_list` | read (no secrets in the response) |
| `bank_integrations_sync` | trigger a run |
| `bank_transactions_list` | the inbox, filterable by status |
| `bank_transactions_assign` | assign to a contract |
| `bank_transactions_ignore` | ignore |
| `payment_rule_get` | read a contract's rule + health |
| `payment_rule_set` | upsert a contract's rule |
| `bank_integrations_setup_url` | returns a deep link for adding an integration |

Integration **create/update/delete are deliberately not exposed over MCP** — they carry
a credential, and a stdio agent is the wrong place to handle one.

Instead, when a user asks an agent to add a bank integration, `bank_integrations_setup_url`
returns a deep link into the platform — `<APP_URL>/settings?tab=bank&action=new` — for
the user to open and fill in themselves. The agent gets to complete the request
usefully without ever touching a password, and the credential is typed straight into
the app over HTTPS. The UI must honour `action=new` by opening the create dialog on
load.

## Testing

Following the repo's `freshDb()` pattern; every test provisions its own database.

**Fixtures.** `tests/fixtures/kb-payment-notification.eml` is a **sanitized** copy of
the real notification — account numbers, the recipient address, `Message-ID` and
tracker URLs all replaced with placeholders, per the no-real-PII rule. Synthesized
variants alongside it:

| Fixture | Asserts |
|---|---|
| all symbols empty (the real sample) | empty values parse as `null`, not as the next label |
| VS/KS/SS and message populated | positional read is correct when values exist |
| amount `35 000,00 Kč` | NBSP thousands separator → `3500000` haléře |
| non-CZK amount | `status='ignored'`, `unsupported_currency` |
| CZ says 30,00 / EN says 40.00 | `cz_en_mismatch`, refuses |
| restructured HTML (spans removed) | `unexpected_structure`, does **not** half-parse |
| a label renamed | `unexpected_structure`, with that assertion named |
| labels reordered | `unexpected_structure` — order is asserted, not just presence |
| a label with no following span | `unexpected_structure`, not silently `null` |
| unrelated e-mail | `not_kb_notification`, and must **not** escalate the integration to `error` |
| prefixless vs prefixed account | both parse; they do **not** compare equal |

**Test files**

- `tests/kb-email-parser.test.ts` — pure, drives the fixture table above.
- `tests/payment-pairing.test.ts` — pure: the criteria matrix, wildcards, inclusive
  amount bounds, leading-zero symbol equality, the contract-active-on-`valueDate`
  window, ambiguity with two matching rules, rejection of an empty rule.
- `tests/account-number.test.ts` — leading-zero normalization both directions, an
  all-zero prefix collapsing to absent, and the load-bearing negative: a prefixed and
  a prefixless account with the same number are **not** equal.
- `tests/crypto-box.test.ts` — seal/open roundtrip, tamper detection, wrong-key
  failure, key-length validation.
- `tests/bank-sync.test.ts` — `freshDb()` plus a **fake `fetchMessages`**, so CI never
  opens a socket: running twice imports once; the cursor advances; a parse failure is
  recorded *and* the cursor still advances; an ambiguous match creates no payment; a
  foreign `toAccount` is ignored; a unique match creates a correctly-shaped payment.
  Plus the two guards added in review:
  - **Resend guard**: the same payment arriving under a *different* `Message-ID`
    creates **no** second payment, lands as `suspected_duplicate` with
    `duplicateOfTransactionId` set — and confirming it manually then *does* create the
    payment, so a genuine identical transfer is recoverable rather than lost.
  - **Structural drift**: a notification failing an assertion sets
    `lastSyncStatus='error'` on the integration, whereas an unrelated e-mail
    (`not_kb_notification`) leaves it `ok`.
- `tests/bank-integrations.test.ts` — routes: a restricted member gets 403 on the
  integration and inbox endpoints; the password is absent from every response; cross-org
  reads 404; the cron endpoint returns 401 with a missing, empty or wrong bearer and
  200 with the right one.
- `tests/payment-rule.test.ts` — routes: property-access enforcement, upsert
  idempotence, the unique-per-contract constraint, derived health states.

`tests/reference-property-2024.test.ts` must stay green — this feature adds no
allocation or reconciliation logic, so a change there means something leaked.

## Risks and open questions

1. **Hobby cron is once a day.** Acceptable for monthly rent; needs Pro (or a GitHub
   Actions schedule hitting the same endpoint) for anything tighter.
2. ~~**Outbound IMAP from a Vercel function is unverified.**~~ **Resolved 2026-08-20 —
   verified working.** A throwaway `node:tls` probe deployed to a preview
   (`spike/imap-from-vercel`, since deleted) opened port 993 successfully from the
   function:

   | Target | Connect | TLS | Result |
   |---|---|---|---|
   | `imap.gmail.com:993` | 38 ms | TLSv1.3 | greeting + `CAPABILITY` OK, offers `AUTH=PLAIN` |
   | `outlook.office365.com:993` | 17 ms | TLSv1.3 | OK |
   | `imap.seznam.cz:993` | 29 ms | TLSv1.3 | OK |

   Runtime `node v24.18.0`, region `fra1`, `VERCEL=1`; all three probed in 98 ms
   total — faster than from a local machine, so the handshake is not a meaningful
   part of the time budget. Gmail offering `AUTH=PLAIN` confirms the App Password
   path works. No fallback trigger is needed; Vercel Cron stands.
3. **KB can change the template.** Mitigated by explicit
   [structural validation](#structural-validation-of-the-notification), the CZ/EN
   cross-check, the `parse_failed` status with named failed assertions, retained
   `rawTokens`, a red integration pill and a reparse action — but a redesign of their
   mail will still need a parser update. The design guarantees you *find out
   immediately*, not that no work is needed.
4. **Gmail needs an App Password** (the sample was delivered to Gmail), which requires
   2FA on the account. Now a **requirement**: inline help text beside the password
   field in the integration dialog.
5. **No bank transaction ID.** Two identical transfers on the same day arrive as two
   e-mails with distinct `Message-ID`s and are handled correctly. A *resent*
   notification for the same payment is now caught by the
   [duplicate guard](#duplicate-guard) — held as `suspected_duplicate`, never
   auto-paired and never auto-discarded. The residual risk is narrow and accepted: two
   truly identical transfers, same day, same symbols, same amount, need one manual
   confirmation click.
6. **Rent and services arriving as two separate transfers** can't both match one rule
   with a narrow amount band. The band should then be widened to cover either transfer,
   and the existing rent-first allocation sorts out the rest. If this turns out to be
   the normal case, the rule-list option we declined becomes worth revisiting.
7. **Dates are calendar dates, not instants.** *Splatnost* is stored as a `date` with
   no timezone maths, consistent with `payment.paidAt`.

## Implementation order

1. ~~**Probe**: throwaway check that IMAP works from a Vercel preview function.~~
   **Done 2026-08-20** — see risk 2. Port 993 is reachable from `fra1`; nothing in the
   hosting plan needs to change.
2. `crypto-box` + `account-number` + `kb-email-parser` (including structural
   validation) + `payment-pairing` — all pure, all test-first, no DB.
3. Schema + migration; `pnpm db:generate`, review the SQL for destructive steps. Note
   `bank_transaction.duplicateOfTransactionId` is a self-reference, which Drizzle needs
   an explicit return type for.
4. `imap-fetcher` and the sync service with the injected fetcher, including the
   duplicate guard; sync tests.
5. Routes, including the pre-auth cron route; route tests.
6. `vercel.json` crons/maxDuration, `.env.example`, `DEPLOY.md`.
7. MCP tools.
8. Settings page shell, bank tab, inbox.
9. "Párování plateb" card and its dialog on the pronájem detail.
