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
