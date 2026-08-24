import { describe, it, expect } from 'vitest';
import {
  nextCursor, nextSearchRange, searchCriteria, exceedsSizeCap, MAX_MESSAGE_BYTES,
} from '../core/lib/imap-fetcher.js';

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

describe('nextCursor', () => {
  // `nextCursor`'s third argument is the highest UID actually PROCESSED —
  // fetched or deliberately skipped — not the highest UID in a `messages`
  // array. See imap-fetch-processed-cursor.test.ts for coverage of the loop
  // that derives this value, including the deliberate-skip cases that were
  // the actual bug.
  it('advances to the highest uid it actually processed', () => {
    expect(nextCursor({ uidValidity: 111, lastUid: 42 }, 111, 47))
      .toEqual({ uidValidity: 111, lastUid: 47 });
  });

  it('keeps the high-water mark when a quiet run processed nothing', () => {
    expect(nextCursor({ uidValidity: 111, lastUid: 42 }, 111, null))
      .toEqual({ uidValidity: 111, lastUid: 42 });
  });

  // The load-bearing case. Pairing the server's NEW uidValidity with the OLD
  // generation's lastUid makes nextSearchRange call the cursor usable forever
  // and search oldLastUid+1:* in a mailbox whose UIDs restarted low — so
  // everything at or below the old mark is permanently invisible. And the
  // precondition is ordinary: a rebuild plus any day with no notification.
  it('drops a stale lastUid when uidValidity changed and nothing was processed', () => {
    expect(nextCursor({ uidValidity: 111, lastUid: 42 }, 222, null))
      .toEqual({ uidValidity: 222, lastUid: null });
  });

  it('takes the new generation\'s own uid when a rebuilt mailbox did process a message', () => {
    expect(nextCursor({ uidValidity: 111, lastUid: 42 }, 222, 3))
      .toEqual({ uidValidity: 222, lastUid: 3 });
  });

  it('leaves the cursor unusable after a first run that processed nothing', () => {
    const c = nextCursor({ uidValidity: null, lastUid: null }, 111, null);
    expect(c).toEqual({ uidValidity: 111, lastUid: null });
    // Belt and braces: the two functions must agree about the same cursor.
    expect(nextSearchRange(c, 111, FALLBACK).kind).toBe('since');
  });
});

// The sync search must carry the sender filter, exactly as probeConnection's
// already did. Without it every message in the folder — spam included — spent
// one of the run's 25 slots and was downloaded in full, so a busy folder never
// caught up and payment notifications were delayed indefinitely.
describe('searchCriteria', () => {
  it('carries the sender filter in a uid-range search', () => {
    expect(searchCriteria({ kind: 'uid', range: '43:*' }, 'servis@kbinfo.cz'))
      .toEqual({ uid: '43:*', from: 'servis@kbinfo.cz' });
  });

  it('carries the sender filter in a date search', () => {
    expect(searchCriteria({ kind: 'since', since: FALLBACK }, 'servis@kbinfo.cz'))
      .toEqual({ since: FALLBACK, from: 'servis@kbinfo.cz' });
  });
});

describe('exceedsSizeCap', () => {
  it('accepts a real notification with room to spare', () => {
    // The committed fixture is 77 905 bytes.
    expect(exceedsSizeCap(77_905)).toBe(false);
    expect(exceedsSizeCap(MAX_MESSAGE_BYTES)).toBe(false);
  });

  it('refuses a body the parser would refuse anyway, before downloading it', () => {
    expect(exceedsSizeCap(MAX_MESSAGE_BYTES + 1)).toBe(true);
  });

  it('does not treat an unreported size as oversized', () => {
    // A server that declines RFC822.SIZE must not cost us real mail; the
    // parser's own caps still bound the work.
    expect(exceedsSizeCap(undefined)).toBe(false);
  });
});
