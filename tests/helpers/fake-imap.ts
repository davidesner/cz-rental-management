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
