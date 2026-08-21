# Bank Payment Pairing — Plan 1: Pure Libraries and Schema

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four framework-free libraries the bank sync rests on — secret sealing, Czech account normalization, KB e-mail parsing, and rule matching — plus the database schema, with no I/O anywhere.

**Architecture:** Everything here is a pure function over in-memory values, tested without a network socket and (except the schema task) without a database. `core/lib/*` files export narrow, named functions; no class hierarchies, no DI containers. The schema task lands the four new tables so Plan 2 has something to write to.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, Drizzle ORM (postgres-js), `node:crypto`, `mailparser`, `node-html-parser`.

**Spec:** `docs/superpowers/specs/2026-08-20-bank-payment-pairing-design.md`

## Global Constraints

- **Money is integer haléře (CZK × 100), never float.** No `parseFloat` on an amount, anywhere.
- **ESM import specifiers end in `.js`** even for TypeScript sources (`./account-number.js`), matching every existing file in `core/`.
- **`core/` is framework-free.** No Hono, no `process.env` reads inside `core/lib/*` — the caller passes config in. (`crypto-box.ts` exports a key *loader* that takes the raw string; it does not read the env itself.)
- **No real PII in code or docs.** Test fixtures use placeholder accounts, `example.com` / `.invalid` addresses. The sanitizer in Task 3 is the only thing that touches the real e-mail, and its output is what gets committed.
- **Tests need an admin Postgres URL:** `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" pnpm test`
- **`pnpm build` is typecheck only** (`tsc --noEmit`). Run it before every commit.
- **Work on the branch `feat/bank-payment-pairing`.** `main` is protected; never commit there.
- **Never mutate `validFrom` of an existing SCD2 row.** Nothing in this plan touches SCD2 tables, but the rule applies repo-wide.
- **Drizzle workflow for schema changes:** edit `core/db/schema.ts` → `pnpm db:generate` → **read the generated SQL** → `pnpm db:migrate`. `drizzle-kit` can emit destructive steps; the generated file is the only place you'll catch that.

---

### Task 1: `crypto-box` — seal and open IMAP passwords

AES-256-GCM with a versioned envelope, so a future scheme can coexist. The auth tag makes tampering and key mismatch fail loudly instead of yielding garbage.

**Files:**
- Create: `core/lib/crypto-box.ts`
- Test: `tests/crypto-box.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `loadKey(raw: string | undefined): Buffer` — throws `Error` unless `raw` is base64 decoding to exactly 32 bytes.
  - `seal(plaintext: string, key: Buffer): string` — returns `v1:<iv>:<tag>:<ciphertext>`, all base64url.
  - `open(sealed: string, key: Buffer): string` — throws on any tamper, wrong key, or unknown version.

- [ ] **Step 1: Write the failing test**

Create `tests/crypto-box.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadKey, seal, open } from '../core/lib/crypto-box.js';

const KEY = randomBytes(32);
const KEY_B64 = KEY.toString('base64');

describe('crypto-box', () => {
  it('roundtrips a password', () => {
    const sealed = seal('hunter2-app-password', KEY);
    expect(open(sealed, KEY)).toBe('hunter2-app-password');
  });

  it('roundtrips non-ASCII and empty strings', () => {
    expect(open(seal('přílišžluťoučký', KEY), KEY)).toBe('přílišžluťoučký');
    expect(open(seal('', KEY), KEY)).toBe('');
  });

  it('produces a v1 envelope with four base64url parts', () => {
    const parts = seal('x', KEY).split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    // base64url: no +, /, or = padding
    for (const p of parts.slice(1)) expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('uses a fresh IV per call, so the same plaintext seals differently', () => {
    expect(seal('same', KEY)).not.toBe(seal('same', KEY));
  });

  it('rejects a tampered ciphertext', () => {
    const parts = seal('secret', KEY).split(':');
    // Flip a character in the ciphertext segment
    const ct = parts[3]!;
    parts[3] = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
    expect(() => open(parts.join(':'), KEY)).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const parts = seal('secret', KEY).split(':');
    const tag = parts[2]!;
    parts[2] = (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1);
    expect(() => open(parts.join(':'), KEY)).toThrow();
  });

  it('rejects the wrong key', () => {
    const sealed = seal('secret', KEY);
    expect(() => open(sealed, randomBytes(32))).toThrow();
  });

  it('rejects an unknown envelope version', () => {
    const sealed = seal('secret', KEY).replace(/^v1:/, 'v2:');
    expect(() => open(sealed, KEY)).toThrow(/unsupported ciphertext/);
  });

  it('rejects a malformed envelope', () => {
    expect(() => open('not-an-envelope', KEY)).toThrow(/unsupported ciphertext/);
  });

  describe('loadKey', () => {
    it('accepts 32 base64 bytes', () => {
      expect(loadKey(KEY_B64).length).toBe(32);
    });
    it('rejects undefined', () => {
      expect(() => loadKey(undefined)).toThrow(/not set/);
    });
    it('rejects a key of the wrong length', () => {
      expect(() => loadKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/crypto-box.test.ts`
Expected: FAIL — `Cannot find module '../core/lib/crypto-box.js'`

- [ ] **Step 3: Write the implementation**

Create `core/lib/crypto-box.ts`:

```ts
// Authenticated encryption for secrets we must store but never display —
// currently the IMAP password on bank_integration.
//
// The `v1:` prefix is deliberate: it lets a future scheme (different cipher,
// KDF-derived key, KMS envelope) coexist with rows written today, so key
// rotation becomes an additive change rather than a migration that must
// re-encrypt everything atomically.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for
const KEY_BYTES = 32;

/**
 * Decode and validate the raw base64 key (from BANK_SECRET_KEY).
 *
 * Deliberately takes the string rather than reading process.env itself: core/
 * is framework- and environment-free, and a bad key must fail at a call site
 * that can report it, not at module load.
 */
export function loadKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error('BANK_SECRET_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`BANK_SECRET_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function open(sealed: string, key: Buffer): string {
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(`unsupported ciphertext format`);
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64!, 'base64url'));
  // Throws on mismatch in final() below — this is what makes a tampered row or
  // a wrong key an error rather than silent garbage.
  decipher.setAuthTag(Buffer.from(tagB64!, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64!, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/crypto-box.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm build
git add core/lib/crypto-box.ts tests/crypto-box.test.ts
git commit -m "feat(core): AES-256-GCM seal/open for stored secrets

Versioned envelope (v1:iv:tag:ciphertext, base64url) so a future scheme can
coexist with existing rows. loadKey takes the raw string rather than reading
process.env, keeping core/ environment-free."
```

---

### Task 2: `account-number` — Czech account normalization

The notification prints `123-1234567890/0100` when an account has a prefix and `294153028/0300` when it doesn't. Both forms occur on both sides of a comparison. **The prefix is significant** — two accounts differing only by prefix are different accounts.

**Files:**
- Create: `core/lib/account-number.ts`
- Test: `tests/account-number.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseAccount(raw: string): ParsedAccount | null` where `ParsedAccount = { prefix: string | null; number: string; bankCode: string }`
  - `normalizeAccount(raw: string): string` — canonical form; unparseable input returned trimmed, verbatim.
  - `accountsEqual(a: string | null | undefined, b: string | null | undefined): boolean` — `false` if either side is nullish.

- [ ] **Step 1: Write the failing test**

Create `tests/account-number.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseAccount, normalizeAccount, accountsEqual } from '../core/lib/account-number.js';

describe('account-number', () => {
  describe('parseAccount', () => {
    it('splits a prefixed account', () => {
      expect(parseAccount('123-1234567890/0100'))
        .toEqual({ prefix: '123', number: '1234567890', bankCode: '0100' });
    });

    it('splits a prefixless account', () => {
      expect(parseAccount('294153028/0300'))
        .toEqual({ prefix: null, number: '294153028', bankCode: '0300' });
    });

    it('tolerates whitespace around the separators', () => {
      expect(parseAccount('  123 - 1234567890 / 0100  '))
        .toEqual({ prefix: '123', number: '1234567890', bankCode: '0100' });
    });

    it('returns null for junk', () => {
      expect(parseAccount('')).toBeNull();
      expect(parseAccount('not an account')).toBeNull();
      expect(parseAccount('123456/12')).toBeNull();       // bank code must be 4 digits
      expect(parseAccount('12345678901/0100')).toBeNull(); // number caps at 10 digits
    });
  });

  describe('normalizeAccount', () => {
    it('leaves a canonical account untouched', () => {
      expect(normalizeAccount('123-1234567890/0100')).toBe('123-1234567890/0100');
      expect(normalizeAccount('294153028/0300')).toBe('294153028/0300');
    });

    it('strips leading zeros from prefix and number', () => {
      expect(normalizeAccount('000123-0001234567/0100')).toBe('123-1234567/0100');
    });

    it('treats an all-zero prefix as absent — same account, two spellings', () => {
      expect(normalizeAccount('000-294153028/0300')).toBe('294153028/0300');
      expect(normalizeAccount('0-294153028/0300')).toBe('294153028/0300');
    });

    it('keeps the bank code at four digits, zeros included', () => {
      expect(normalizeAccount('294153028/0300')).toBe('294153028/0300');
      expect(normalizeAccount('294153028/0100')).toBe('294153028/0100');
    });

    it('returns unparseable input trimmed and verbatim', () => {
      expect(normalizeAccount('  CZ6508000000192000145399  ')).toBe('CZ6508000000192000145399');
    });
  });

  describe('accountsEqual', () => {
    it('matches across cosmetic differences', () => {
      expect(accountsEqual('000123-0001234567/0100', '123-1234567/0100')).toBe(true);
      expect(accountsEqual(' 294153028 / 0300 ', '294153028/0300')).toBe(true);
      expect(accountsEqual('000-294153028/0300', '294153028/0300')).toBe(true);
    });

    // THE LOAD-BEARING NEGATIVE. A rule entered without a prefix must not
    // match a transaction that has one — they are different accounts, and
    // silently collapsing them would pair a payment to the wrong contract.
    it('treats a prefixed and a prefixless account as different', () => {
      expect(accountsEqual('123-294153028/0300', '294153028/0300')).toBe(false);
    });

    it('does not match on bank code alone', () => {
      expect(accountsEqual('294153028/0300', '294153028/0100')).toBe(false);
    });

    it('is false when either side is missing', () => {
      expect(accountsEqual(null, '294153028/0300')).toBe(false);
      expect(accountsEqual('294153028/0300', undefined)).toBe(false);
      expect(accountsEqual(null, null)).toBe(false);
    });

    it('matches unparseable input only against itself verbatim', () => {
      expect(accountsEqual('CZ65 0800 0000 1920 0014 5399', 'CZ65 0800 0000 1920 0014 5399')).toBe(true);
      expect(accountsEqual('CZ6508000000192000145399', 'CZ65 0800 0000 1920 0014 5399')).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/account-number.test.ts`
Expected: FAIL — `Cannot find module '../core/lib/account-number.js'`

- [ ] **Step 3: Write the implementation**

Create `core/lib/account-number.ts`:

```ts
// Czech domestic account numbers: [prefix-]number/bankCode.
//
// Both the KB notification and a user-entered pairing rule may or may not carry
// the prefix, so comparison needs a canonical form. The prefix is part of the
// account's identity though — 123-294153028/0300 and 294153028/0300 are
// DIFFERENT accounts, and normalization must not collapse them. Only an
// all-zero prefix means "no prefix".

export interface ParsedAccount {
  prefix: string | null;
  number: string;
  bankCode: string;
}

// Prefix: up to 6 digits. Number: up to 10 digits. Bank code: exactly 4.
const ACCOUNT_RE = /^\s*(?:(\d{1,6})\s*-\s*)?(\d{1,10})\s*\/\s*(\d{4})\s*$/;

function stripLeadingZeros(s: string): string {
  return s.replace(/^0+/, '');
}

export function parseAccount(raw: string): ParsedAccount | null {
  const m = ACCOUNT_RE.exec(raw);
  if (!m) return null;
  const [, rawPrefix, rawNumber, bankCode] = m;
  const prefix = stripLeadingZeros(rawPrefix ?? '');
  return {
    // An all-zero (or absent) prefix normalizes to null — same account, two spellings.
    prefix: prefix === '' ? null : prefix,
    // An all-zero number is not a real account, but collapsing it to '' would be
    // worse than keeping a literal '0'.
    number: stripLeadingZeros(rawNumber!) || '0',
    bankCode: bankCode!,
  };
}

export function normalizeAccount(raw: string): string {
  const parsed = parseAccount(raw);
  // Unparseable input (an IBAN, a typo) is preserved rather than discarded, so
  // it can still match an identically-written value and stays visible in the UI.
  if (!parsed) return raw.trim();
  const prefix = parsed.prefix === null ? '' : `${parsed.prefix}-`;
  return `${prefix}${parsed.number}/${parsed.bankCode}`;
}

export function accountsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  // A rule criterion of null means "cokoliv" and is handled by the caller before
  // it gets here; a *transaction* with no account can never satisfy an account
  // criterion, so nullish is always false rather than a wildcard.
  if (!a || !b) return false;
  return normalizeAccount(a) === normalizeAccount(b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/account-number.test.ts`
Expected: PASS — 17 tests

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm build
git add core/lib/account-number.ts tests/account-number.test.ts
git commit -m "feat(core): normalize Czech account numbers for pairing comparison

Canonicalises [prefix-]number/bankCode across the spellings that appear in KB
notifications and hand-entered rules. The prefix stays significant: collapsing
123-294153028/0300 and 294153028/0300 would pair payments to the wrong
contract, so accountsEqual reports them different."
```

---

### Task 3: `kb-email-parser` — parse the KB notification

The largest task here. Fields sit in a flat, ordered `<span>` sequence where each label span is immediately followed by its value span, and **values can be empty** — so parsing is positional and the *shape* is validated before any value is trusted.

**Files:**
- Create: `core/lib/kb-email-parser.ts`
- Create: `tests/fixtures/kb-payment-notification.eml` (generated by the sanitizer in Step 1)
- Create: `scripts/sanitize-kb-fixture.py`
- Create: `tests/helpers/kb-email.ts`
- Test: `tests/kb-email-parser.test.ts`
- Modify: `package.json` — add `mailparser`, `node-html-parser`, `@types/mailparser`

**Interfaces:**
- Consumes: `normalizeAccount` from Task 2.
- Produces:
  - `type ParseReason = 'not_kb_notification' | 'unexpected_structure' | 'missing_amount' | 'missing_value_date' | 'missing_to_account' | 'cz_en_mismatch'`
  - `interface ParsedNotification { messageId: string; receivedAt: Date; amount: number; currency: string; valueDate: string; fromAccount: string | null; toAccount: string | null; vs: string | null; ks: string | null; ss: string | null; messageForRecipient: string | null; sourceLink: string | null; tokens: string[] }`
  - `type ParseResult = { ok: true; value: ParsedNotification } | { ok: false; reason: ParseReason; detail: string; tokens: string[]; messageId: string | null; receivedAt: Date | null }`
  - `parseKbPaymentNotification(raw: Buffer, filters: { fromFilter: string; subjectFilter: string }): Promise<ParseResult>`
  - `extractSpanTokens(html: string): string[]` (exported for the reparse path in Plan 2)
  - `parseFromTokens(tokens: string[], ctx: { messageId: string; receivedAt: Date; sourceLink: string | null }): ParseResult` (exported so Plan 2 can re-parse a stored `rawTokens` array without the original e-mail)

> **One deliberate deviation from the spec.** The spec lists `unsupported_currency` among the parser's reason codes. We do not implement it there: a EUR notification *parses perfectly*, it just isn't something we act on. The parser reports `currency` as a fact and the sync service in Plan 2 applies the CZK policy (`status='ignored'`, `statusReason='unsupported_currency'`). Observable behaviour is identical; the responsibility sits in the layer that owns policy.

- [ ] **Step 1: Add dependencies and generate the sanitized fixture**

```bash
pnpm add mailparser node-html-parser
pnpm add -D @types/mailparser
mkdir -p tests/fixtures
```

Create `scripts/sanitize-kb-fixture.py`:

```python
#!/usr/bin/env python3
"""Build a committable test fixture from a real KB payment notification.

The real mail contains actual account numbers, the recipient's address and
single-use click-tracking URLs, none of which may enter the repo. This rebuilds
the message with the same headers and structure but placeholder values, so the
parser is exercised against KB's real HTML shape without leaking anything.

Usage:
    python3 scripts/sanitize-kb-fixture.py <source.eml> tests/fixtures/kb-payment-notification.eml
"""
import email
import itertools
import re
import sys
from email import policy
from email.message import EmailMessage

FROM_ACCOUNT = '123-1234567890/0100'   # payer (tenant)
TO_ACCOUNT = '321-9876543210/0100'     # payee (landlord)
TRACKER = 'https://link.kbinfo.cz/f/a/FIXTURE~~/AAAAARA~/FIXTUREFIXTUREFIXTURE~'


def sanitize(html: str) -> str:
    # Accounts appear in document order: from, to (Czech block), then from, to
    # (English block). Cycle placeholders so both blocks stay consistent, which
    # matters because the parser cross-checks the two halves.
    accounts = itertools.cycle([FROM_ACCOUNT, TO_ACCOUNT])
    html = re.sub(r'\d{1,6}-\d{6,10}/\d{4}', lambda _: next(accounts), html)
    # Click-trackers are single-use and identify the recipient.
    html = re.sub(r'https://link\.kbinfo\.cz/[^"\']+', TRACKER, html)
    # Any surviving e-mail address that isn't KB's own public contact.
    html = re.sub(r'[\w.+-]+@(?!kb\.cz|kbinfo\.cz)[\w.-]+\.\w+', 'landlord@example.com', html)
    return html


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, out = sys.argv[1], sys.argv[2]
    msg = email.message_from_binary_file(open(src, 'rb'), policy=policy.default)
    html = next(p.get_content() for p in msg.walk() if p.get_content_type() == 'text/html')

    fixture = EmailMessage()
    fixture['From'] = 'Komerční banka <servis@kbinfo.cz>'
    fixture['Reply-To'] = 'Komerční banka <kbplus@kb.cz>'
    fixture['To'] = 'landlord@example.com'
    fixture['Subject'] = 'Servisní zpráva: Přijali jsme platbu na Váš účet'
    fixture['Date'] = 'Thu, 20 Aug 2026 10:52:24 +0000'
    fixture['Message-ID'] = '<FIXTURE-0001@example.invalid>'
    fixture.set_content(sanitize(html), subtype='html', charset='utf-8', cte='quoted-printable')

    with open(out, 'wb') as fh:
        fh.write(fixture.as_bytes())
    print(f'wrote {out}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
```

Run it against the real notification, then **verify no leakage before committing**:

```bash
python3 scripts/sanitize-kb-fixture.py \
  "$HOME/Documents/Prace/PROJECTS/ADHOC/Servisní zpráva_ Přijali jsme platbu na Váš účet.eml" \
  tests/fixtures/kb-payment-notification.eml

# Must print nothing. If it prints anything, the sanitizer missed a pattern.
grep -aoE '[0-9]{1,6}-[0-9]{6,10}/[0-9]{4}' tests/fixtures/kb-payment-notification.eml \
  | sort -u | grep -v -e '123-1234567890/0100' -e '321-9876543210/0100'
grep -aoE '[[:alnum:]._+-]+@[[:alnum:].-]+' tests/fixtures/kb-payment-notification.eml \
  | sort -u | grep -v -e 'landlord@example.com' -e '@kb.cz' -e '@kbinfo.cz' -e '@example.invalid'
```

Expected: both greps print nothing.

- [ ] **Step 2: Write the fixture helper**

Create `tests/helpers/kb-email.ts`:

```ts
// Helpers for building parser test inputs from the one committed fixture.
//
// Only ONE .eml is committed: the real KB shape, sanitized. Every variant
// (populated symbols, drifted template, currency change) is derived from it at
// runtime, so there is a single source of truth for what KB's HTML looks like.
import { readFile } from 'node:fs/promises';
import { simpleParser } from 'mailparser';

const FIXTURE = new URL('../fixtures/kb-payment-notification.eml', import.meta.url);

export async function loadFixtureEml(): Promise<Buffer> {
  return readFile(FIXTURE);
}

export async function loadFixtureHtml(): Promise<string> {
  const parsed = await simpleParser(await loadFixtureEml());
  if (!parsed.html) throw new Error('fixture has no HTML part');
  return parsed.html;
}

export interface EmlOverrides {
  messageId?: string;
  date?: string;
  subject?: string;
  from?: string;
}

/** Wrap an HTML body into a minimal KB-shaped message. */
export function makeEml(html: string, o: EmlOverrides = {}): Buffer {
  const headers = [
    `From: ${o.from ?? 'Komerční banka <servis@kbinfo.cz>'}`,
    `To: landlord@example.com`,
    `Subject: ${o.subject ?? 'Servisní zpráva: Přijali jsme platbu na Váš účet'}`,
    `Date: ${o.date ?? 'Thu, 20 Aug 2026 10:52:24 +0000'}`,
    `Message-ID: ${o.messageId ?? '<FIXTURE-0001@example.invalid>'}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ].join('\r\n');
  return Buffer.from(`${headers}\r\n\r\n${html}`, 'utf8');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fill in the empty value span that follows `label`.
 *
 * KB renders both label and value as <font color="#212121">…</font>; the value
 * for an unset field is an empty one. This finds the first empty value font
 * after the label and injects text into it.
 */
export function setFieldValue(html: string, label: string, value: string): string {
  const re = new RegExp(`(${escapeRegex(label)}[\\s\\S]*?<font color="#212121">)(</font>)`);
  if (!re.test(html)) throw new Error(`no empty value slot found after label "${label}"`);
  return html.replace(re, `$1${value}$2`);
}
```

- [ ] **Step 3: Write the failing test**

Create `tests/kb-email-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseKbPaymentNotification, extractSpanTokens } from '../core/lib/kb-email-parser.js';
import { loadFixtureEml, loadFixtureHtml, makeEml, setFieldValue } from './helpers/kb-email.js';

const FILTERS = { fromFilter: 'servis@kbinfo.cz', subjectFilter: 'Přijali jsme platbu' };

async function parse(raw: Buffer) {
  return parseKbPaymentNotification(raw, FILTERS);
}

describe('kb-email-parser', () => {
  it('parses the real notification shape, with every symbol empty', async () => {
    const res = await parse(await loadFixtureEml());
    if (!res.ok) throw new Error(`expected ok, got ${res.reason}: ${res.detail}`);

    expect(res.value.amount).toBe(3000);            // 30,00 Kč
    expect(res.value.currency).toBe('CZK');
    expect(res.value.valueDate).toBe('2026-08-20'); // Splatnost: 20. 08. 2026
    expect(res.value.fromAccount).toBe('123-1234567890/0100');
    expect(res.value.toAccount).toBe('321-9876543210/0100');
    // THE point of positional parsing: empty values must be null, not the
    // following label.
    expect(res.value.vs).toBeNull();
    expect(res.value.ks).toBeNull();
    expect(res.value.ss).toBeNull();
    expect(res.value.messageForRecipient).toBeNull();
    expect(res.value.messageId).toBe('FIXTURE-0001@example.invalid');
    expect(res.value.sourceLink).toContain('link.kbinfo.cz');
    expect(res.value.tokens.length).toBeGreaterThan(20);
  });

  it('reads populated symbols and the message', async () => {
    let html = await loadFixtureHtml();
    html = setFieldValue(html, 'Zpráva pro příjemce', 'najem 8/2026');
    html = setFieldValue(html, 'Variabilní symbol', '2026008');
    html = setFieldValue(html, 'Konstantní symbol', '0308');
    html = setFieldValue(html, 'Specifický symbol', '77');

    const res = await parse(makeEml(html));
    if (!res.ok) throw new Error(`expected ok, got ${res.reason}: ${res.detail}`);
    expect(res.value.messageForRecipient).toBe('najem 8/2026');
    expect(res.value.vs).toBe('2026008');
    expect(res.value.ks).toBe('0308');
    expect(res.value.ss).toBe('77');
  });

  it('handles a thousands separator (NBSP) in the amount', async () => {
    const html = (await loadFixtureHtml())
      .replace('30,00&nbsp;Kč', '35 000,00&nbsp;Kč')
      .replace('30,00 Kč', '35 000,00 Kč')
      .replace('30.00 CZK', '35,000.00 CZK');
    const res = await parse(makeEml(html));
    if (!res.ok) throw new Error(`expected ok, got ${res.reason}: ${res.detail}`);
    expect(res.value.amount).toBe(3_500_000);
  });

  it('reports the currency without judging it', async () => {
    const html = (await loadFixtureHtml())
      .replace(/30,00(&nbsp;| )Kč/, '30,00$1EUR')
      .replace('30.00 CZK', '30.00 EUR');
    const res = await parse(makeEml(html));
    if (!res.ok) throw new Error(`expected ok, got ${res.reason}: ${res.detail}`);
    // Policy lives in the sync service, not here.
    expect(res.value.currency).toBe('EUR');
  });

  it('refuses when the Czech and English halves disagree on the amount', async () => {
    const html = (await loadFixtureHtml()).replace('30.00 CZK', '40.00 CZK');
    const res = await parse(makeEml(html));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('cz_en_mismatch');
  });

  it('refuses when the halves disagree on the date', async () => {
    const html = (await loadFixtureHtml()).replace('08-20-2026', '08-21-2026');
    const res = await parse(makeEml(html));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('cz_en_mismatch');
  });

  describe('structural validation', () => {
    it('rejects a renamed label and names the failed assertion', async () => {
      const html = (await loadFixtureHtml()).replace('Variabilní symbol', 'Variabilni symbol XX');
      const res = await parse(makeEml(html));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe('unexpected_structure');
      expect(res.detail).toContain('Variabilní symbol');
      // The tokens survive, so the row is still storable and re-parseable.
      expect(res.tokens.length).toBeGreaterThan(10);
      expect(res.messageId).toBe('FIXTURE-0001@example.invalid');
    });

    it('rejects reordered labels — order is asserted, not just presence', async () => {
      const html = (await loadFixtureHtml())
        .replace('Variabilní symbol', '@@TMP@@')
        .replace('Specifický symbol', 'Variabilní symbol')
        .replace('@@TMP@@', 'Specifický symbol');
      const res = await parse(makeEml(html));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe('unexpected_structure');
      expect(res.detail).toMatch(/order/i);
    });

    it('rejects a structure with no spans at all', async () => {
      const res = await parse(makeEml('<html><body><p>Přijali jsme platbu 30,00 Kč</p></body></html>'));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe('unexpected_structure');
    });

    it('rejects a label that is the last span, with no value slot', async () => {
      const tokens = ['Z účtu', '123-1/0100', 'Na účet', '321-2/0100',
        'Zpráva pro příjemce', '', 'Variabilní symbol', '', 'Konstantní symbol', '',
        'Specifický symbol'];
      const html = `<html><body>${tokens.map(t => `<span>${t}</span>`).join('')}</body></html>`;
      const res = await parse(makeEml(html));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe('unexpected_structure');
    });
  });

  describe('sender and subject gating', () => {
    it('rejects an unrelated sender', async () => {
      const res = await parse(makeEml(await loadFixtureHtml(), { from: 'newsletter@example.com' }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      // Benign — must be distinguishable from unexpected_structure so the sync
      // does not escalate the integration to an error state.
      expect(res.reason).toBe('not_kb_notification');
    });

    it('rejects an unrelated subject', async () => {
      const res = await parse(makeEml(await loadFixtureHtml(), { subject: 'Výpis z účtu' }));
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.reason).toBe('not_kb_notification');
    });

    it('matches the subject case- and diacritic-insensitively', async () => {
      const res = await parse(makeEml(await loadFixtureHtml(), {
        subject: 'Servisni zprava: PRIJALI JSME PLATBU na Vas ucet',
      }));
      expect(res.ok).toBe(true);
    });
  });

  describe('extractSpanTokens', () => {
    it('preserves empty spans, which is what makes positional reads work', () => {
      const tokens = extractSpanTokens('<span>A</span><span></span><span>B</span>');
      expect(tokens).toEqual(['A', '', 'B']);
    });

    it('strips invisible padding characters KB injects', () => {
      // \u00a0 NBSP, \ufeff BOM, \u034f grapheme joiner, \u200b zero-width space —
      // spelled as escapes so this test stays reviewable.
      const raw = '<span>\u00a0\ufeff\u034f 30,00\u00a0Kč \u200b</span>';
      expect(extractSpanTokens(raw)).toEqual(['30,00 Kč']);
    });

    it('flattens nested markup inside a span', () => {
      const tokens = extractSpanTokens('<span><a><font>Z účtu</font></a></span>');
      expect(tokens).toEqual(['Z účtu']);
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/kb-email-parser.test.ts`
Expected: FAIL — `Cannot find module '../core/lib/kb-email-parser.js'`

- [ ] **Step 5: Write the implementation**

Create `core/lib/kb-email-parser.ts`:

```ts
// Parses the Komerční banka "Přijali jsme platbu na Váš účet" notification.
//
// Shape of the mail (verified against a real message): a single text/html part,
// quoted-printable, UTF-8, no plain-text alternative. Every payment field lives
// in a flat, document-ordered sequence of <span> elements where a label span is
// immediately followed by its value span:
//
//     'Z účtu'              '123-…/0100'
//     'Na účet'             '321-…/0100'
//     'Zpráva pro příjemce' ''             <-- empty when unset
//     'Variabilní symbol'   ''
//
// Two consequences drive the whole design:
//
//   1. Values can be EMPTY, so "the next non-empty text" would read the
//      FOLLOWING LABEL as the value. Reads must be positional.
//   2. Because empty and missing look identical once read, the STRUCTURE is
//      validated before any value is trusted (see validateStructure). A KB
//      template change then produces a loud `unexpected_structure` rather than
//      a half-populated payment.
//
// The mail also mirrors every field in English with different amount and date
// formats, which we exploit as a free cross-check.
import { simpleParser } from 'mailparser';
import { parse as parseHtml } from 'node-html-parser';
import { normalizeAccount } from './account-number.js';

export type ParseReason =
  | 'not_kb_notification'
  | 'unexpected_structure'
  | 'missing_amount'
  | 'missing_value_date'
  | 'missing_to_account'
  | 'cz_en_mismatch';

export interface ParsedNotification {
  messageId: string;
  receivedAt: Date;
  amount: number;      // haléře
  currency: string;    // ISO-ish; 'Kč' is reported as 'CZK'
  valueDate: string;   // YYYY-MM-DD, from "Splatnost"
  fromAccount: string | null;
  toAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  messageForRecipient: string | null;
  sourceLink: string | null;
  tokens: string[];
}

export type ParseResult =
  | { ok: true; value: ParsedNotification }
  | {
      ok: false;
      reason: ParseReason;
      detail: string;
      // Retained on failure so the caller can still persist a visible,
      // re-parseable row instead of dropping the message.
      tokens: string[];
      messageId: string | null;
      receivedAt: Date | null;
    };

const CZ_LABELS = {
  fromAccount: 'Z účtu',
  toAccount: 'Na účet',
  messageForRecipient: 'Zpráva pro příjemce',
  vs: 'Variabilní symbol',
  ks: 'Konstantní symbol',
  ss: 'Specifický symbol',
} as const;

// Order the labels must appear in. Asserted, not merely their presence — a
// reordered template would otherwise silently swap two values.
const CZ_ORDER: readonly string[] = [
  CZ_LABELS.fromAccount, CZ_LABELS.toAccount, CZ_LABELS.messageForRecipient,
  CZ_LABELS.vs, CZ_LABELS.ks, CZ_LABELS.ss,
];

const AMOUNT_CZ = /platbu\s+([\d\s]+(?:,\d{1,2})?)\s*(Kč|CZK|EUR|USD)/i;
const AMOUNT_EN = /payment\s+([\d,]+(?:\.\d{1,2})?)\s*([A-Za-z]{3})/;
const DATE_CZ = /Splatnost:\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/;
const DATE_EN = /Due date:\s*(\d{1,2})-(\d{1,2})-(\d{4})/;

// Soft hyphen, combining grapheme joiner, zero-width space family, BOM — KB
// pads its templates with these for layout and preheader control.
//
// Written as \u escapes on purpose: these characters are INVISIBLE in an editor,
// so a literal character class here would be unreviewable and easy to corrupt on
// copy-paste.
const INVISIBLE = /[\u00ad\u034f\u200b-\u200f\u2060\ufeff]/g;

function clean(s: string): string {
  return s
    .replace(INVISIBLE, '')
    .replace(/\u00a0/g, ' ') // NBSP → space, so the amount's thousands separator strips cleanly
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercase and strip diacritics, so subject matching survives transliteration. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function extractSpanTokens(html: string): string[] {
  const root = parseHtml(html);
  // querySelectorAll returns document order, which is exactly the label→value
  // adjacency we depend on. Empty spans are KEPT: they are the value slots of
  // unset fields, and dropping them would shift every subsequent read by one.
  return root.querySelectorAll('span').map((el) => clean(el.text));
}

function czAmountToHaler(raw: string): number | null {
  // '35 000,00' -> 3500000. Integer arithmetic only; never parseFloat on money.
  const m = /^(\d+)(?:,(\d{1,2}))?$/.exec(raw.replace(/\s/g, ''));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

function enAmountToHaler(raw: string): number | null {
  // '35,000.00' -> 3500000
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.replace(/,/g, ''));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

function iso(y: string, m: string, d: string): string {
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

interface StructureError { detail: string }

/**
 * Assert the mail still has the shape we know how to read, before trusting any
 * value. Returns the label→index map on success.
 */
function validateStructure(tokens: string[]): { index: Map<string, number> } | StructureError {
  if (tokens.length === 0) return { detail: 'no <span> elements found in the message body' };

  const index = new Map<string, number>();
  const problems: string[] = [];

  for (const label of CZ_ORDER) {
    const hits = tokens.reduce<number[]>((acc, t, i) => (t === label ? [...acc, i] : acc), []);
    if (hits.length !== 1) {
      problems.push(`label "${label}" found ${hits.length} times, expected exactly 1`);
      continue;
    }
    const at = hits[0]!;
    // Every label needs a following span to hold its value — even an empty one.
    if (at + 1 >= tokens.length) {
      problems.push(`label "${label}" has no following value span`);
      continue;
    }
    index.set(label, at);
  }
  if (problems.length > 0) return { detail: problems.join('; ') };

  const positions = CZ_ORDER.map((l) => index.get(l)!);
  for (let i = 1; i < positions.length; i++) {
    if (positions[i]! <= positions[i - 1]!) {
      return { detail: `labels are out of order: "${CZ_ORDER[i]}" appears before "${CZ_ORDER[i - 1]}"` };
    }
  }

  const hasCzAmount = tokens.some((t) => AMOUNT_CZ.test(t));
  if (!hasCzAmount) problems.push('no span matches the amount headline pattern');
  const hasCzDate = tokens.some((t) => DATE_CZ.test(t));
  if (!hasCzDate) problems.push('no span matches the "Splatnost" date pattern');
  // The English mirror is what the cross-check reads; losing it silently would
  // disable a correctness guard rather than break anything visibly.
  const hasEnAmount = tokens.some((t) => AMOUNT_EN.test(t));
  if (!hasEnAmount) problems.push('the English mirror block is missing its amount');
  if (problems.length > 0) return { detail: problems.join('; ') };

  return { index };
}

function valueAfter(tokens: string[], index: Map<string, number>, label: string): string | null {
  const v = tokens[index.get(label)! + 1] ?? '';
  return v === '' ? null : v;
}

/**
 * Parse from an already-extracted token array. Exported so a stored `rawTokens`
 * snapshot can be re-parsed after a parser fix, without the original e-mail.
 */
export function parseFromTokens(
  tokens: string[],
  ctx: { messageId: string; receivedAt: Date; sourceLink: string | null },
): ParseResult {
  const fail = (reason: ParseReason, detail: string): ParseResult => ({
    ok: false, reason, detail, tokens, messageId: ctx.messageId, receivedAt: ctx.receivedAt,
  });

  const structure = validateStructure(tokens);
  if ('detail' in structure) return fail('unexpected_structure', structure.detail);
  const { index } = structure;

  const czAmountToken = tokens.find((t) => AMOUNT_CZ.test(t))!;
  const czAmountMatch = AMOUNT_CZ.exec(czAmountToken)!;
  const amount = czAmountToHaler(czAmountMatch[1]!);
  if (amount === null) return fail('missing_amount', `unparseable amount "${czAmountMatch[1]}"`);
  const rawCurrency = czAmountMatch[2]!;
  const currency = /^kč$/i.test(rawCurrency) ? 'CZK' : rawCurrency.toUpperCase();

  const czDateToken = tokens.find((t) => DATE_CZ.test(t))!;
  const czDate = DATE_CZ.exec(czDateToken)!;
  const valueDate = iso(czDate[3]!, czDate[2]!, czDate[1]!);

  // Cross-check against the English mirror: different formats, same facts.
  const enAmountToken = tokens.find((t) => AMOUNT_EN.test(t));
  if (enAmountToken) {
    const enMatch = AMOUNT_EN.exec(enAmountToken)!;
    const enAmount = enAmountToHaler(enMatch[1]!);
    if (enAmount !== null && enAmount !== amount) {
      return fail('cz_en_mismatch', `amount cz=${amount} en=${enAmount}`);
    }
  }
  const enDateToken = tokens.find((t) => DATE_EN.test(t));
  if (enDateToken) {
    const enDate = DATE_EN.exec(enDateToken)!;
    // English format is MM-DD-YYYY.
    const enIso = iso(enDate[3]!, enDate[1]!, enDate[2]!);
    if (enIso !== valueDate) {
      return fail('cz_en_mismatch', `value date cz=${valueDate} en=${enIso}`);
    }
  }

  const rawFrom = valueAfter(tokens, index, CZ_LABELS.fromAccount);
  const rawTo = valueAfter(tokens, index, CZ_LABELS.toAccount);
  if (rawTo === null) return fail('missing_to_account', 'the "Na účet" value span is empty');

  return {
    ok: true,
    value: {
      messageId: ctx.messageId,
      receivedAt: ctx.receivedAt,
      amount,
      currency,
      valueDate,
      fromAccount: rawFrom === null ? null : normalizeAccount(rawFrom),
      toAccount: normalizeAccount(rawTo),
      vs: valueAfter(tokens, index, CZ_LABELS.vs),
      ks: valueAfter(tokens, index, CZ_LABELS.ks),
      ss: valueAfter(tokens, index, CZ_LABELS.ss),
      messageForRecipient: valueAfter(tokens, index, CZ_LABELS.messageForRecipient),
      sourceLink: ctx.sourceLink,
      tokens,
    },
  };
}

/** The "Zobrazit online" href — stored as a source link and NEVER fetched by us
 *  (it is a click-tracker; following it registers a click and may be single-use). */
function findSourceLink(html: string): string | null {
  const root = parseHtml(html);
  for (const a of root.querySelectorAll('a')) {
    if (fold(clean(a.text)).includes('zobrazit online')) {
      return a.getAttribute('href') ?? null;
    }
  }
  return null;
}

export async function parseKbPaymentNotification(
  raw: Buffer,
  filters: { fromFilter: string; subjectFilter: string },
): Promise<ParseResult> {
  const mail = await simpleParser(raw);
  const messageId = mail.messageId?.replace(/^<|>$/g, '') ?? null;
  const receivedAt = mail.date ?? null;

  const bail = (reason: ParseReason, detail: string, tokens: string[] = []): ParseResult => ({
    ok: false, reason, detail, tokens, messageId, receivedAt,
  });

  const fromText = mail.from?.text ?? '';
  if (!fold(fromText).includes(fold(filters.fromFilter))) {
    return bail('not_kb_notification', `sender "${fromText}" does not match "${filters.fromFilter}"`);
  }
  const subject = mail.subject ?? '';
  if (!fold(subject).includes(fold(filters.subjectFilter))) {
    return bail('not_kb_notification', `subject "${subject}" does not match "${filters.subjectFilter}"`);
  }
  if (!mail.html) return bail('unexpected_structure', 'message has no text/html part');
  if (!messageId) return bail('unexpected_structure', 'message has no Message-ID header');

  const tokens = extractSpanTokens(mail.html);
  return parseFromTokens(tokens, {
    messageId,
    receivedAt: receivedAt ?? new Date(0),
    sourceLink: findSourceLink(mail.html),
  });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/kb-email-parser.test.ts`
Expected: PASS — 17 tests

If the "thousands separator" or "currency" tests fail on the `.replace()` not matching, print the fixture's headline span to see its exact entity encoding:

```bash
npx tsx -e "import('./tests/helpers/kb-email.js').then(async m => console.log((await m.loadFixtureHtml()).match(/.{80}platbu.{120}/s)))"
```

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm build
git add core/lib/kb-email-parser.ts tests/kb-email-parser.test.ts tests/helpers/kb-email.ts \
        tests/fixtures/kb-payment-notification.eml scripts/sanitize-kb-fixture.py \
        package.json pnpm-lock.yaml
git commit -m "feat(core): parse KB incoming-payment notification e-mails

Positional label→value reads over the document-ordered span sequence, because
KB renders unset fields as EMPTY value spans — 'next non-empty text' would read
the following label as the value.

Structure is validated before any value is trusted (labels present, unique, in
order, each with a value slot; amount/date patterns; English mirror present),
so a template change yields a loud unexpected_structure with the failing
assertions rather than a half-populated payment. The English mirror block is
also cross-checked against the Czech one for amount and date.

Fixture is the real KB HTML with accounts, recipient and click-trackers
replaced; scripts/sanitize-kb-fixture.py regenerates it."
```

---

### Task 4: `payment-pairing` — evaluate matching rules

Pure predicate evaluation: which contract, if any, does this transaction belong to?

**Files:**
- Create: `core/lib/payment-pairing.ts`
- Test: `tests/payment-pairing.test.ts`

**Interfaces:**
- Consumes: `accountsEqual` from Task 2.
- Produces:
  - `interface MatchableTransaction { amount: number; valueDate: string; fromAccount: string | null; vs: string | null; ks: string | null; ss: string | null }`
  - `interface MatchingRule { contractId: string; counterpartyAccount: string | null; vs: string | null; ks: string | null; ss: string | null; amountFrom: number | null; amountTo: number | null; active: boolean; contractStartDate: string; contractEndDate: string | null }`
  - `type MatchResult = { kind: 'none' } | { kind: 'one'; contractId: string } | { kind: 'many'; contractIds: string[] }`
  - `stripSymbolZeros(s: string | null | undefined): string`
  - `ruleMatches(rule: MatchingRule, tx: MatchableTransaction): boolean`
  - `matchTransaction(tx: MatchableTransaction, rules: MatchingRule[]): MatchResult`
  - `validateRuleCriteria(r: Pick<MatchingRule, 'counterpartyAccount' | 'vs' | 'ks' | 'ss' | 'amountFrom' | 'amountTo'>): string | null` — returns an error message, or `null` when valid.

- [ ] **Step 1: Write the failing test**

Create `tests/payment-pairing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ruleMatches, matchTransaction, validateRuleCriteria, stripSymbolZeros,
  type MatchingRule, type MatchableTransaction,
} from '../core/lib/payment-pairing.js';

const TX: MatchableTransaction = {
  amount: 3_800_000,               // 38 000,00 Kč
  valueDate: '2026-08-20',
  fromAccount: '294153028/0300',
  vs: '2026008',
  ks: '0308',
  ss: '77',
};

// A rule that matches TX on every criterion; tests narrow from here.
const RULE: MatchingRule = {
  contractId: 'c1',
  counterpartyAccount: '294153028/0300',
  vs: '2026008',
  ks: '0308',
  ss: '77',
  amountFrom: 3_500_000,
  amountTo: 4_120_000,
  active: true,
  contractStartDate: '2024-09-01',
  contractEndDate: null,
};

const rule = (o: Partial<MatchingRule> = {}): MatchingRule => ({ ...RULE, ...o });
const tx = (o: Partial<MatchableTransaction> = {}): MatchableTransaction => ({ ...TX, ...o });

describe('payment-pairing', () => {
  describe('ruleMatches', () => {
    it('matches when every criterion holds', () => {
      expect(ruleMatches(rule(), tx())).toBe(true);
    });

    it('treats a null criterion as cokoliv', () => {
      const wide = rule({ counterpartyAccount: null, vs: null, ks: null, ss: null });
      expect(ruleMatches(wide, tx({ fromAccount: '999/0800', vs: null, ks: null, ss: null }))).toBe(true);
    });

    it('requires the account to match when set', () => {
      expect(ruleMatches(rule(), tx({ fromAccount: '111222333/0800' }))).toBe(false);
      expect(ruleMatches(rule(), tx({ fromAccount: null }))).toBe(false);
    });

    it('ignores leading zeros in symbols', () => {
      expect(ruleMatches(rule({ vs: '0002026008' }), tx({ vs: '2026008' }))).toBe(true);
      expect(ruleMatches(rule({ ks: '308' }), tx({ ks: '0308' }))).toBe(true);
    });

    it('requires a symbol to be present on the transaction when the rule sets it', () => {
      expect(ruleMatches(rule(), tx({ vs: null }))).toBe(false);
    });

    it('applies amount bounds inclusively', () => {
      expect(ruleMatches(rule(), tx({ amount: 3_500_000 }))).toBe(true);
      expect(ruleMatches(rule(), tx({ amount: 4_120_000 }))).toBe(true);
      expect(ruleMatches(rule(), tx({ amount: 3_499_999 }))).toBe(false);
      expect(ruleMatches(rule(), tx({ amount: 4_120_001 }))).toBe(false);
    });

    it('supports a one-sided amount bound', () => {
      expect(ruleMatches(rule({ amountFrom: 3_500_000, amountTo: null }), tx({ amount: 9_000_000 }))).toBe(true);
      expect(ruleMatches(rule({ amountFrom: null, amountTo: 4_120_000 }), tx({ amount: 1 }))).toBe(true);
    });

    it('never matches an inactive rule', () => {
      expect(ruleMatches(rule({ active: false }), tx())).toBe(false);
    });

    // Stops an ended lease's stale rule from stealing the next tenant's payment.
    it('requires the contract to be active on the value date', () => {
      expect(ruleMatches(rule({ contractStartDate: '2026-09-01' }), tx())).toBe(false);
      expect(ruleMatches(rule({ contractEndDate: '2026-07-31' }), tx())).toBe(false);
      expect(ruleMatches(rule({ contractEndDate: '2026-08-20' }), tx())).toBe(true); // inclusive
      expect(ruleMatches(rule({ contractStartDate: '2026-08-20' }), tx())).toBe(true); // inclusive
    });
  });

  describe('matchTransaction', () => {
    it('reports none when nothing matches', () => {
      expect(matchTransaction(tx(), [rule({ vs: '999' })])).toEqual({ kind: 'none' });
      expect(matchTransaction(tx(), [])).toEqual({ kind: 'none' });
    });

    it('reports the single matching contract', () => {
      expect(matchTransaction(tx(), [rule({ contractId: 'c1' }), rule({ contractId: 'c2', vs: '999' })]))
        .toEqual({ kind: 'one', contractId: 'c1' });
    });

    it('reports ambiguity rather than guessing', () => {
      const res = matchTransaction(tx(), [rule({ contractId: 'c1' }), rule({ contractId: 'c2' })]);
      expect(res.kind).toBe('many');
      if (res.kind !== 'many') return;
      expect(res.contractIds.sort()).toEqual(['c1', 'c2']);
    });
  });

  describe('validateRuleCriteria', () => {
    const base = { counterpartyAccount: null, vs: null, ks: null, ss: null, amountFrom: null, amountTo: null };

    it('rejects a rule with no criteria — it would match every transaction', () => {
      expect(validateRuleCriteria(base)).toMatch(/alespoň jedno kritérium/);
    });

    it('accepts a rule with a single criterion', () => {
      expect(validateRuleCriteria({ ...base, vs: '2026008' })).toBeNull();
      expect(validateRuleCriteria({ ...base, amountFrom: 100 })).toBeNull();
    });

    it('rejects an inverted amount band', () => {
      expect(validateRuleCriteria({ ...base, amountFrom: 500, amountTo: 100 })).toMatch(/Částka od/);
    });

    it('rejects a symbol that is only zeros, which would strip to empty', () => {
      expect(validateRuleCriteria({ ...base, vs: '000' })).toMatch(/symbol/);
      expect(validateRuleCriteria({ ...base, vs: '   ' })).toMatch(/symbol/);
    });

    it('rejects a negative amount bound', () => {
      expect(validateRuleCriteria({ ...base, amountFrom: -1 })).toMatch(/nesmí být negativní/);
    });
  });

  describe('stripSymbolZeros', () => {
    it('normalizes for comparison', () => {
      expect(stripSymbolZeros('0123')).toBe('123');
      expect(stripSymbolZeros(' 123 ')).toBe('123');
      expect(stripSymbolZeros(null)).toBe('');
      expect(stripSymbolZeros('000')).toBe('');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/payment-pairing.test.ts`
Expected: FAIL — `Cannot find module '../core/lib/payment-pairing.js'`

- [ ] **Step 3: Write the implementation**

Create `core/lib/payment-pairing.ts`:

```ts
// Decides which contract an incoming bank transaction belongs to.
//
// One rule per contract (see the spec's decision table). A rule is a conjunction
// of OPTIONAL criteria: every non-null criterion must hold, and a null one means
// "cokoliv". Because a rule with no criteria at all would match every
// transaction in the org, that is rejected at write time by
// validateRuleCriteria rather than tolerated here.
import { accountsEqual } from './account-number.js';

export interface MatchableTransaction {
  amount: number;      // haléře
  valueDate: string;   // YYYY-MM-DD
  fromAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
}

export interface MatchingRule {
  contractId: string;
  counterpartyAccount: string | null;
  vs: string | null;
  ks: string | null;
  ss: string | null;
  amountFrom: number | null;
  amountTo: number | null;
  active: boolean;
  // Denormalised from the contract so this stays a pure function. The caller
  // joins them in.
  contractStartDate: string;
  contractEndDate: string | null;
}

export type MatchResult =
  | { kind: 'none' }
  | { kind: 'one'; contractId: string }
  | { kind: 'many'; contractIds: string[] };

/** Bank symbols are numeric strings where leading zeros are not significant. */
export function stripSymbolZeros(s: string | null | undefined): string {
  if (s == null) return '';
  return s.trim().replace(/^0+/, '');
}

function symbolMatches(ruleValue: string | null, txValue: string | null): boolean {
  if (ruleValue === null) return true; // cokoliv
  const wanted = stripSymbolZeros(ruleValue);
  // validateRuleCriteria guarantees `wanted` is non-empty, so an absent symbol
  // on the transaction can never satisfy a rule that specifies one.
  return wanted === stripSymbolZeros(txValue);
}

function contractActiveOn(rule: MatchingRule, date: string): boolean {
  if (date < rule.contractStartDate) return false;
  if (rule.contractEndDate !== null && date > rule.contractEndDate) return false;
  return true;
}

export function ruleMatches(rule: MatchingRule, tx: MatchableTransaction): boolean {
  if (!rule.active) return false;
  // A payment dated outside the lease is not this lease's payment, even if the
  // symbols still line up — this is what stops a stale rule on an ended
  // contract from capturing the next tenant's money.
  if (!contractActiveOn(rule, tx.valueDate)) return false;

  if (rule.counterpartyAccount !== null && !accountsEqual(rule.counterpartyAccount, tx.fromAccount)) return false;
  if (!symbolMatches(rule.vs, tx.vs)) return false;
  if (!symbolMatches(rule.ks, tx.ks)) return false;
  if (!symbolMatches(rule.ss, tx.ss)) return false;
  if (rule.amountFrom !== null && tx.amount < rule.amountFrom) return false;
  if (rule.amountTo !== null && tx.amount > rule.amountTo) return false;

  return true;
}

export function matchTransaction(tx: MatchableTransaction, rules: MatchingRule[]): MatchResult {
  const hits = rules.filter((r) => ruleMatches(r, tx)).map((r) => r.contractId);
  // Deduplicate defensively: the DB has a unique index on contractId, so two
  // rules for one contract shouldn't exist, but reporting 'many' for a single
  // contract would block a payment for no reason.
  const unique = [...new Set(hits)];
  if (unique.length === 0) return { kind: 'none' };
  if (unique.length === 1) return { kind: 'one', contractId: unique[0]! };
  return { kind: 'many', contractIds: unique };
}

type RuleCriteria = Pick<MatchingRule,
  'counterpartyAccount' | 'vs' | 'ks' | 'ss' | 'amountFrom' | 'amountTo'>;

/**
 * Write-time validation. Messages are Czech — they surface directly in the UI.
 * Returns null when the rule is acceptable.
 */
export function validateRuleCriteria(r: RuleCriteria): string | null {
  const symbols: Array<[string, string | null]> = [['Variabilní', r.vs], ['Konstantní', r.ks], ['Specifický', r.ss]];
  for (const [name, value] of symbols) {
    // A symbol of '000' or '   ' strips to empty, which would then match an
    // ABSENT symbol on the transaction and quietly widen the rule.
    if (value !== null && stripSymbolZeros(value) === '') {
      return `${name} symbol nesmí být prázdný ani samé nuly — pro „cokoliv" nech pole nevyplněné`;
    }
  }
  for (const [name, value] of [['Částka od', r.amountFrom], ['Částka do', r.amountTo]] as const) {
    if (value !== null && value < 0) return `${name} nesmí být negativní`;
  }
  if (r.amountFrom !== null && r.amountTo !== null && r.amountFrom > r.amountTo) {
    return 'Částka od nesmí být větší než Částka do';
  }
  const hasAny = r.counterpartyAccount !== null || r.vs !== null || r.ks !== null
    || r.ss !== null || r.amountFrom !== null || r.amountTo !== null;
  if (!hasAny) return 'Pravidlo musí mít alespoň jedno kritérium, jinak by spárovalo každou platbu';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/payment-pairing.test.ts`
Expected: PASS — 20 tests

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm build
git add core/lib/payment-pairing.ts tests/payment-pairing.test.ts
git commit -m "feat(core): match bank transactions against per-contract pairing rules

A rule is a conjunction of optional criteria (null = cokoliv). Candidate rules
are additionally gated on the contract being active on the transaction's value
date, so an ended lease's stale rule cannot capture the next tenant's payment.

Ambiguity is reported, never guessed. A criteria-less rule would match every
transaction in the org, so validateRuleCriteria rejects it at write time —
along with all-zero symbols, which would strip to empty and silently match an
absent symbol."
```

---

### Task 5: Schema — four new tables

**Files:**
- Modify: `core/db/schema.ts` (append after `rentReduction`)
- Create: `drizzle/<generated>.sql` (via `pnpm db:generate`)
- Test: `tests/schema-bank.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces Drizzle table objects `bankIntegration`, `bankTransaction`, `paymentMatchingRule`, `bankSyncRun`, all exported from `core/db/schema.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/schema-bank.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { freshDb } from './helpers/db.js';
import {
  organization, property, tenant, contract, payment,
  bankIntegration, bankTransaction, paymentMatchingRule, bankSyncRun,
} from '../core/db/schema.js';

async function seed() {
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
    imapHost: 'imap.example.com', imapUser: 'u@example.com', imapPasswordEnc: 'v1:a:b:c',
  });
  return { db, client, orgId, propertyId, contractId, integrationId };
}

const txValues = (o: { orgId: string; integrationId: string; messageId: string }) => ({
  id: createId(), ...o,
  amount: 3_800_000, currency: 'CZK', valueDate: '2026-08-20',
  status: 'unmatched' as const, receivedAt: new Date(),
});

describe('bank schema', () => {
  it('applies defaults on bank_integration', async () => {
    const { db, client, integrationId } = await seed();
    const [row] = await db.select().from(bankIntegration).where(eq(bankIntegration.id, integrationId));
    expect(row!.imapPort).toBe(993);
    expect(row!.imapFolder).toBe('INBOX');
    expect(row!.fromFilter).toBe('servis@kbinfo.cz');
    expect(row!.subjectFilter).toBe('Přijali jsme platbu');
    expect(row!.active).toBe(true);
    expect(row!.lastUid).toBeNull();
    await client.close();
  });

  it('enforces one bank_transaction per (orgId, messageId)', async () => {
    const { db, client, orgId, integrationId } = await seed();
    await db.insert(bankTransaction).values(txValues({ orgId, integrationId, messageId: 'm1' }));
    await expect(
      db.insert(bankTransaction).values(txValues({ orgId, integrationId, messageId: 'm1' })),
    ).rejects.toThrow();
    await client.close();
  });

  it('allows the same messageId in a different org', async () => {
    const { db, client, orgId, integrationId } = await seed();
    await db.insert(bankTransaction).values(txValues({ orgId, integrationId, messageId: 'm1' }));
    const otherOrg = createId();
    await db.insert(organization).values({ id: otherOrg, name: 'O2' });
    const otherIntegration = createId();
    await db.insert(bankIntegration).values({
      id: otherIntegration, orgId: otherOrg, kind: 'kb_email', name: 'KB2',
      imapHost: 'h', imapUser: 'u', imapPasswordEnc: 'v1:a:b:c',
    });
    await expect(
      db.insert(bankTransaction).values(txValues({ orgId: otherOrg, integrationId: otherIntegration, messageId: 'm1' })),
    ).resolves.toBeDefined();
    await client.close();
  });

  // paymentId IS NULL is the source of truth for "needs attention", so the FK
  // must null out rather than cascade the transaction away with the payment.
  it('nulls paymentId when the payment is deleted, keeping the transaction', async () => {
    const { db, client, orgId, integrationId, contractId } = await seed();
    const paymentId = createId();
    await db.insert(payment).values({
      id: paymentId, orgId, contractId, amount: 3_800_000,
      paidAt: '2026-08-20', source: 'bank', externalId: 'kbemail:m1',
    });
    const txId = createId();
    await db.insert(bankTransaction).values({
      ...txValues({ orgId, integrationId, messageId: 'm1' }),
      id: txId, status: 'matched', matchedBy: 'rule', paymentId,
    });

    await db.delete(payment).where(eq(payment.id, paymentId));

    const [row] = await db.select().from(bankTransaction).where(eq(bankTransaction.id, txId));
    expect(row).toBeDefined();
    expect(row!.paymentId).toBeNull();
    await client.close();
  });

  it('supports the self-reference used for suspected duplicates', async () => {
    const { db, client, orgId, integrationId } = await seed();
    const originalId = createId();
    await db.insert(bankTransaction).values({ ...txValues({ orgId, integrationId, messageId: 'm1' }), id: originalId });
    await db.insert(bankTransaction).values({
      ...txValues({ orgId, integrationId, messageId: 'm2' }),
      status: 'suspected_duplicate', duplicateOfTransactionId: originalId,
    });
    const rows = await db.select().from(bankTransaction).where(eq(bankTransaction.duplicateOfTransactionId, originalId));
    expect(rows).toHaveLength(1);
    await client.close();
  });

  it('enforces one matching rule per contract', async () => {
    const { db, client, orgId, contractId } = await seed();
    await db.insert(paymentMatchingRule).values({ id: createId(), orgId, contractId, vs: '2026008' });
    await expect(
      db.insert(paymentMatchingRule).values({ id: createId(), orgId, contractId, vs: '999' }),
    ).rejects.toThrow();
    await client.close();
  });

  it('stores a sync run with counters', async () => {
    const { db, client, integrationId } = await seed();
    const id = createId();
    await db.insert(bankSyncRun).values({ id, integrationId, trigger: 'cron', status: 'ok', fetched: 3, created: 2, matched: 1, failed: 0 });
    const [row] = await db.select().from(bankSyncRun).where(eq(bankSyncRun.id, id));
    expect(row!.fetched).toBe(3);
    expect(row!.finishedAt).toBeNull();
    await client.close();
  });

  it('cascades transactions and runs when the integration is deleted', async () => {
    const { db, client, orgId, integrationId } = await seed();
    await db.insert(bankTransaction).values(txValues({ orgId, integrationId, messageId: 'm1' }));
    await db.insert(bankSyncRun).values({ id: createId(), integrationId, trigger: 'manual', status: 'ok' });
    await db.delete(bankIntegration).where(eq(bankIntegration.id, integrationId));
    expect(await db.select().from(bankTransaction)).toHaveLength(0);
    expect(await db.select().from(bankSyncRun)).toHaveLength(0);
    await client.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/schema-bank.test.ts`
Expected: FAIL — `bankIntegration` is not exported from `../core/db/schema.js`

- [ ] **Step 3: Add the tables to the schema**

In `core/db/schema.ts`, extend the import on line 1 to include `jsonb` and `type AnyPgColumn`:

```ts
import { bigint, boolean, date, integer, jsonb, pgTable, text, timestamp, primaryKey, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';
```

Then append at the end of the file:

```ts
// ----- bank integration + payment pairing -----

export const bankIntegration = pgTable('bank_integration', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  // Discriminator with exactly one value today. A second bank is a new parser
  // file plus a case — deliberately not a plugin framework.
  kind: text('kind', { enum: ['kb_email'] }).notNull(),
  name: text('name').notNull(),
  imapHost: text('imap_host').notNull(),
  imapPort: integer('imap_port').notNull().default(993),
  imapUser: text('imap_user').notNull(),
  // AES-256-GCM ciphertext from core/lib/crypto-box.ts. NEVER returned by the API.
  imapPasswordEnc: text('imap_password_enc').notNull(),
  imapFolder: text('imap_folder').notNull().default('INBOX'),
  fromFilter: text('from_filter').notNull().default('servis@kbinfo.cz'),
  subjectFilter: text('subject_filter').notNull().default('Přijali jsme platbu'),
  // Which of the user's OWN accounts this mailbox reports on. When set,
  // notifications addressed elsewhere are ignored rather than imported.
  accountNumber: text('account_number'),
  active: boolean('active').notNull().default(true),
  // IMAP incremental cursor. UIDs are only meaningful within one uidValidity
  // generation; when the server reports a different one, the cursor is rebuilt
  // from a date-based search.
  uidValidity: bigint('uid_validity', { mode: 'number' }),
  lastUid: bigint('last_uid', { mode: 'number' }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSyncStatus: text('last_sync_status', { enum: ['ok', 'error'] }),
  lastSyncError: text('last_sync_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bankTransaction = pgTable('bank_transaction', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  integrationId: text('integration_id').notNull().references(() => bankIntegration.id, { onDelete: 'cascade' }),
  // The e-mail's Message-ID. KB gives us no transaction id, so this is the
  // idempotency key for "have we already imported this notification".
  messageId: text('message_id').notNull(),
  amount: integer('amount_haler').notNull(),
  currency: text('currency').notNull(),
  valueDate: date('value_date', { mode: 'string' }).notNull(),
  fromAccount: text('from_account'),
  toAccount: text('to_account'),
  vs: text('vs'),
  ks: text('ks'),
  ss: text('ss'),
  messageForRecipient: text('message_for_recipient'),
  // The "Zobrazit online" href. Stored for reference and NEVER fetched by us:
  // it is a click-tracker, so following it registers a click and it may be
  // single-use.
  sourceLink: text('source_link'),
  // The ordered <span> token array (~1 KB), enough to re-parse after a parser
  // fix without keeping 90 KB of HTML per message.
  rawTokens: jsonb('raw_tokens').$type<string[]>(),
  status: text('status', {
    enum: ['unmatched', 'matched', 'ambiguous', 'suspected_duplicate', 'ignored', 'parse_failed'],
  }).notNull(),
  statusReason: text('status_reason'),
  duplicateOfTransactionId: text('duplicate_of_transaction_id')
    .references((): AnyPgColumn => bankTransaction.id, { onDelete: 'set null' }),
  matchedBy: text('matched_by', { enum: ['rule', 'manual'] }),
  // ON DELETE SET NULL, not cascade: `paymentId IS NULL` is the source of truth
  // for "needs attention", so deleting a payment must return the transaction to
  // the inbox rather than delete the audit record with it.
  paymentId: text('payment_id').references(() => payment.id, { onDelete: 'set null' }),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgMessage: uniqueIndex('bank_transaction_org_message_idx').on(t.orgId, t.messageId),
}));

export const paymentMatchingRule = pgTable('payment_matching_rule', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  contractId: text('contract_id').notNull().references(() => contract.id, { onDelete: 'cascade' }),
  // null on any criterion means "cokoliv". A rule with every criterion null is
  // rejected in core/lib/payment-pairing.ts#validateRuleCriteria, not here.
  counterpartyAccount: text('counterparty_account'),
  vs: text('vs'),
  ks: text('ks'),
  ss: text('ss'),
  amountFrom: integer('amount_from_haler'),
  amountTo: integer('amount_to_haler'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  contractUnique: uniqueIndex('payment_matching_rule_contract_idx').on(t.contractId),
}));

export const bankSyncRun = pgTable('bank_sync_run', {
  id: text('id').primaryKey(),
  integrationId: text('integration_id').notNull().references(() => bankIntegration.id, { onDelete: 'cascade' }),
  trigger: text('trigger', { enum: ['cron', 'manual'] }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status', { enum: ['ok', 'error'] }).notNull(),
  fetched: integer('fetched').notNull().default(0),
  created: integer('created').notNull().default(0),
  matched: integer('matched').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  // On a structural parse failure this holds the raw HTML, capped — the one
  // case where the tokens alone are not enough to diagnose the drift.
  error: text('error'),
});
```

- [ ] **Step 4: Generate and review the migration**

```bash
pnpm db:generate
```

Then **read the generated file** in `drizzle/`:

```bash
ls -t drizzle/*.sql | head -1 | xargs cat
```

Expected: four `CREATE TABLE` statements, two `CREATE UNIQUE INDEX`, and foreign keys. **There must be no `DROP` or `ALTER … TYPE` statement.** If there is, stop — something else in the schema drifted and needs resolving before this migration goes anywhere near a real database.

- [ ] **Step 5: Apply and run the test**

```bash
pnpm db:migrate
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" npx vitest run tests/schema-bank.test.ts
```

Expected: PASS — 8 tests

- [ ] **Step 6: Run the whole suite and commit**

The full suite must stay green — `tests/reference-property-2024.test.ts` in particular, which pins the reconciliation math. Nothing here should touch it; if it moves, something leaked.

```bash
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" pnpm test
pnpm build
git add core/db/schema.ts drizzle/ tests/schema-bank.test.ts
git commit -m "feat(db): tables for bank integrations, transactions and pairing rules

bank_transaction.paymentId is ON DELETE SET NULL, not cascade: 'paymentId IS
NULL' is the source of truth for 'needs attention', so deleting a payment
returns the transaction to the inbox instead of deleting the audit record.
Unique (orgId, messageId) is the import idempotency key, since KB's
notification carries no transaction id. duplicateOfTransactionId
self-references for the resend guard."
```

---

## Plan 1 Definition of Done

- [ ] `TEST_DATABASE_URL=… pnpm test` green, including the reference reconciliation test
- [ ] `pnpm build` clean
- [ ] Four new `core/lib/*` modules, none of them importing Hono, Drizzle, or reading `process.env`
- [ ] The committed fixture contains no real account number, address, or tracker URL (re-run the two `grep` checks from Task 3, Step 1)
- [ ] Five commits on `feat/bank-payment-pairing`

**Next:** `docs/superpowers/plans/2026-08-20-bank-pairing-plan-2-sync-api-cron.md`
