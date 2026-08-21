import { describe, it, expect } from 'vitest';
import { nextCursor, nextSearchRange } from '../core/lib/imap-fetcher.js';

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

const msg = (uid: number) => ({ uid, source: Buffer.alloc(0) });

describe('nextCursor', () => {
  it('advances to the highest uid it actually fetched', () => {
    expect(nextCursor({ uidValidity: 111, lastUid: 42 }, 111, [msg(43), msg(47)]))
      .toEqual({ uidValidity: 111, lastUid: 47 });
  });

  it('keeps the high-water mark when a quiet run fetched nothing', () => {
    expect(nextCursor({ uidValidity: 111, lastUid: 42 }, 111, []))
      .toEqual({ uidValidity: 111, lastUid: 42 });
  });

  // The load-bearing case. Pairing the server's NEW uidValidity with the OLD
  // generation's lastUid makes nextSearchRange call the cursor usable forever
  // and search oldLastUid+1:* in a mailbox whose UIDs restarted low — so
  // everything at or below the old mark is permanently invisible. And the
  // precondition is ordinary: a rebuild plus any day with no notification.
  it('drops a stale lastUid when uidValidity changed and nothing was fetched', () => {
    expect(nextCursor({ uidValidity: 111, lastUid: 42 }, 222, []))
      .toEqual({ uidValidity: 222, lastUid: null });
  });

  it('takes the new generation\'s own uid when a rebuilt mailbox did return messages', () => {
    expect(nextCursor({ uidValidity: 111, lastUid: 42 }, 222, [msg(3)]))
      .toEqual({ uidValidity: 222, lastUid: 3 });
  });

  it('leaves the cursor unusable after a first run that fetched nothing', () => {
    const c = nextCursor({ uidValidity: null, lastUid: null }, 111, []);
    expect(c).toEqual({ uidValidity: 111, lastUid: null });
    // Belt and braces: the two functions must agree about the same cursor.
    expect(nextSearchRange(c, 111, FALLBACK).kind).toBe('since');
  });
});
