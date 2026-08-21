import { nextCursor } from '../../core/lib/imap-fetcher.js';
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
    // The REAL cursor derivation, not a re-implementation of it: a fake that
    // computes the cursor its own way cannot catch a regression in the one the
    // production fetcher uses.
    return { messages: selected, cursor: nextCursor(cursor, 1, selected), matchedCount: messages.length };
  };
  return { fetchMessages, calls };
}

export function failingImap(message: string) {
  const fetchMessages: FetchMessages = async () => { throw new Error(message); };
  return { fetchMessages };
}

/**
 * Like `fakeImap`, but each mailbox has its OWN messages, keyed by imapUser.
 *
 * Needed for the cron path: syncAllActiveIntegrations passes one SyncDeps to
 * every integration, so a single shared message list would hand every org the
 * same mail and a multi-org test could not tell whose message landed where.
 */
export function fakeImapByUser(byUser: Record<string, Array<{ uid: number; source: Buffer | string }>>) {
  const calls: Array<{ user: string }> = [];
  const fetchMessages: FetchMessages = async (cfg, cursor, opts) => {
    calls.push({ user: cfg.user });
    const after = cursor.lastUid ?? 0;
    const selected: RawMessage[] = (byUser[cfg.user] ?? [])
      .filter((m) => m.uid > after)
      .sort((a, b) => a.uid - b.uid)
      .slice(0, opts.limit)
      .map((m) => ({ uid: m.uid, source: Buffer.isBuffer(m.source) ? m.source : Buffer.from(m.source, 'utf8') }));
    return { messages: selected, cursor: nextCursor(cursor, 1, selected), matchedCount: selected.length };
  };
  return { fetchMessages, calls };
}
