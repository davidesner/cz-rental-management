import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ImapCursor } from '../core/lib/imap-fetcher.js';

/**
 * Regression coverage for the "skipped UID never advances the cursor" bug: a
 * message that is deliberately skipped (oversized, or vanished before
 * fetchOne) must still move the cursor past its UID, or the next run
 * re-selects and re-skips it forever. `tests/imap-cursor.test.ts` covers the
 * pure `nextCursor` function directly; this file drives the REAL
 * `fetchMessagesOverImap` loop (mocking only the IMAP socket) because the bug
 * lives in what the loop passes to `nextCursor`, not in `nextCursor` itself.
 *
 * The mock simulates just enough of imapflow's `ImapFlow` for this file's
 * mailbox model: `mailboxOpen`, `search` (uid-range only — these tests never
 * exercise the date-fallback path), `fetchAll` (sizes) and `fetchOne` (body).
 */
interface FakeMessage {
  uid: number;
  size: number;
  hasBody: boolean;
}

function parseUidRange(range: string): number {
  // Every search in this file is `${n}:*` — see nextSearchRange.
  const m = /^(\d+):\*$/.exec(range);
  if (!m) throw new Error(`unexpected uid range in test mock: ${range}`);
  return Number(m[1]);
}

function makeMailbox(messages: FakeMessage[], uidValidity = 111) {
  return function impl() {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      mailboxOpen: vi.fn().mockResolvedValue({ uidValidity, exists: messages.length }),
      search: vi.fn(async (criteria: { uid?: string; since?: Date }) => {
        // A `since` search (first run / rebuilt uidValidity) matches everything
        // in this file's tiny fixed mailboxes — none of these tests exercise
        // date filtering itself, only what happens to the messages once found.
        if (!criteria.uid) return messages.map((m) => m.uid);
        const from = parseUidRange(criteria.uid);
        return messages.filter((m) => m.uid >= from).map((m) => m.uid);
      }),
      fetchAll: vi.fn(async (uids: number[]) => uids
        .map((uid) => messages.find((m) => m.uid === uid))
        .filter((m): m is FakeMessage => m !== undefined)
        .map((m) => ({ uid: m.uid, size: m.size }))),
      fetchOne: vi.fn(async (uidStr: string) => {
        const uid = Number(uidStr);
        const found = messages.find((m) => m.uid === uid);
        if (!found || !found.hasBody) return false;
        return { uid, source: Buffer.from(`body-${uid}`) };
      }),
      logout: vi.fn().mockResolvedValue(undefined),
    };
  };
}

const imapMocks = vi.hoisted(() => ({ impl: (() => ({})) as () => unknown }));

vi.mock('imapflow', () => ({
  // A real class, not `vi.fn().mockImplementation(arrowFn)`: an arrow function
  // is not constructible, and returning one from mockImplementation makes
  // `new ImapFlow(...)` throw "is not a constructor" in the real fetcher.
  ImapFlow: class {
    constructor() {
      // eslint-disable-next-line no-constructor-return -- deliberate: this
      // whole class exists to return the test's fake client object instead
      // of a real `this`.
      return imapMocks.impl() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  },
}));

const { fetchMessagesOverImap } = await import('../core/lib/imap-fetcher.js');

const CFG = { host: 'h', port: 993, user: 'u', password: 'p', folder: 'INBOX' };
const BASE_OPTS = { limit: 25, sinceFallback: new Date('2026-01-01'), deadline: Date.now() + 60_000, fromFilter: 'servis@kbinfo.cz' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchMessagesOverImap — cursor advances over processed (not just fetched) UIDs', () => {
  it('advances the cursor past a single newest UID that is oversized, so a second run does not re-select it', async () => {
    const messages: FakeMessage[] = [{ uid: 5, size: 999_999_999, hasBody: true }];
    imapMocks.impl = makeMailbox(messages);

    const cursor1: ImapCursor = { uidValidity: 111, lastUid: 4 };
    const run1 = await fetchMessagesOverImap(CFG, cursor1, BASE_OPTS);
    expect(run1.messages).toHaveLength(0);
    expect(run1.matchedCount).toBe(1);
    expect(run1.cursor).toEqual({ uidValidity: 111, lastUid: 5 });

    // Second run, threading the returned cursor back in — the behaviour that
    // was actually broken: without the fix, run1's cursor stays at 4, so this
    // second search would re-select uid 5 (and matchedCount/messages would
    // show it again).
    const run2 = await fetchMessagesOverImap(CFG, run1.cursor, BASE_OPTS);
    expect(run2.matchedCount).toBe(0);
    expect(run2.messages).toHaveLength(0);
    expect(run2.cursor).toEqual({ uidValidity: 111, lastUid: 5 });
  });

  it('advances the cursor past a single newest UID whose body comes back empty, so a second run does not re-select it', async () => {
    const messages: FakeMessage[] = [{ uid: 5, size: 100, hasBody: false }];
    imapMocks.impl = makeMailbox(messages);

    const cursor1: ImapCursor = { uidValidity: 111, lastUid: 4 };
    const run1 = await fetchMessagesOverImap(CFG, cursor1, BASE_OPTS);
    expect(run1.messages).toHaveLength(0);
    expect(run1.cursor).toEqual({ uidValidity: 111, lastUid: 5 });

    const run2 = await fetchMessagesOverImap(CFG, run1.cursor, BASE_OPTS);
    expect(run2.matchedCount).toBe(0);
    expect(run2.messages).toHaveLength(0);
    expect(run2.cursor).toEqual({ uidValidity: 111, lastUid: 5 });
  });

  it('does not advance the cursor past UIDs never reached because the deadline cut the run short', async () => {
    // uid5 fetches successfully, uid6 is a deliberate (oversize) skip, uid7 is
    // never reached because the deadline trips before it is processed. The
    // correct cursor is 6 — past the completed skip, not past the unreached
    // uid7, and (this is the part the old `messages`-array cursor got wrong)
    // NOT 5, because uid6 was genuinely processed even though it produced no
    // fetched message.
    const messages: FakeMessage[] = [
      { uid: 5, size: 100, hasBody: true },
      { uid: 6, size: 999_999_999, hasBody: true },
      { uid: 7, size: 100, hasBody: true },
    ];
    imapMocks.impl = makeMailbox(messages);

    const deadline = 1_000;
    // One Date.now() call per selected uid (3), in order: proceed, proceed, then break.
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(200)
      .mockReturnValueOnce(2_000);

    const cursor1: ImapCursor = { uidValidity: 111, lastUid: 4 };
    const run1 = await fetchMessagesOverImap(CFG, cursor1, { ...BASE_OPTS, deadline });

    expect(run1.messages.map((m) => m.uid)).toEqual([5]);
    expect(run1.cursor).toEqual({ uidValidity: 111, lastUid: 6 });
  });

  it('leaves the cursor unchanged when the deadline expires before anything is processed', async () => {
    const messages: FakeMessage[] = [{ uid: 5, size: 100, hasBody: true }];
    imapMocks.impl = makeMailbox(messages);
    vi.spyOn(Date, 'now').mockReturnValue(2_000);

    const cursor1: ImapCursor = { uidValidity: 111, lastUid: 4 };
    const run1 = await fetchMessagesOverImap(CFG, cursor1, { ...BASE_OPTS, deadline: 1_000 });

    expect(run1.messages).toHaveLength(0);
    expect(run1.cursor).toEqual({ uidValidity: 111, lastUid: 4 });
  });

  it('advances the cursor even when every selected UID in the run is skipped', async () => {
    const messages: FakeMessage[] = [
      { uid: 5, size: 999_999_999, hasBody: true },
      { uid: 6, size: 100, hasBody: false },
    ];
    imapMocks.impl = makeMailbox(messages);

    const cursor1: ImapCursor = { uidValidity: null, lastUid: null };
    const run1 = await fetchMessagesOverImap(CFG, cursor1, { ...BASE_OPTS, sinceFallback: new Date(0) });

    expect(run1.messages).toHaveLength(0);
    expect(run1.cursor).toEqual({ uidValidity: 111, lastUid: 6 });
  });
});
