// The ONLY file in this feature that opens a network socket.
//
// Everything else depends on the FetchMessages type rather than on this
// implementation, so the sync service is tested against an in-memory fake and
// CI never touches a mailbox.
//
// Verified working from a Vercel function (fra1, TLSv1.3, ~38 ms to Gmail) —
// see the risk register in the design spec.
import { ImapFlow, type MessageEnvelopeObject } from 'imapflow';
import { matchesFilters } from './kb-email-parser.js';

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

/**
 * Is a stored cursor meaningful against the mailbox the server just opened?
 *
 * UIDs are only unique within one uidValidity generation, so a cursor from a
 * previous generation says nothing about this one. Hoisted out so
 * `nextSearchRange` (what to search) and `nextCursor` (what to persist) cannot
 * drift apart — they are the same predicate and disagreeing about it is what
 * caused the bug `nextCursor` documents.
 */
export function cursorUsable(cursor: ImapCursor, serverUidValidity: number): boolean {
  return cursor.uidValidity !== null
    && cursor.lastUid !== null
    && cursor.uidValidity === serverUidValidity;
}

export function nextSearchRange(
  cursor: ImapCursor,
  serverUidValidity: number,
  sinceFallback: Date | null,
): SearchRange {
  if (cursorUsable(cursor, serverUidValidity)) return { kind: 'uid', range: `${cursor.lastUid! + 1}:*` };
  return { kind: 'since', since: sinceFallback ?? new Date(0) };
}

/**
 * The cursor to persist after a fetch.
 *
 * The high-water mark may only be carried forward WITHIN the same uidValidity
 * generation. Pairing the server's NEW uidValidity with the OLD generation's
 * lastUid produces a cursor that `nextSearchRange` then calls usable forever,
 * searching `oldLastUid+1:*` in a mailbox whose UIDs restarted low — so every
 * message at or below the old high-water mark becomes permanently invisible.
 * Silent, unrecoverable, money-bearing loss.
 *
 * And the precondition is the NORMAL case, not an exotic one: it needs only a
 * mailbox rebuild plus a run that fetched nothing, and `sinceFallback` is
 * yesterday while rent notifications are monthly. So on a rebuild, a quiet day
 * is enough. Dropping to null instead makes the next run redo the date search,
 * which idempotency on messageId already makes harmless.
 */
export function nextCursor(
  cursor: ImapCursor,
  serverUidValidity: number,
  messages: RawMessage[],
): ImapCursor {
  const carried = cursorUsable(cursor, serverUidValidity) ? cursor.lastUid : null;
  const lastUid = messages.length > 0 ? messages[messages.length - 1]!.uid : carried;
  return { uidValidity: serverUidValidity, lastUid };
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

    // search() resolves to `false` (not null/undefined) when nothing matches,
    // so a plain `?? []` would not catch it — narrow it explicitly.
    const all = (Array.isArray(found) ? found : []).slice().sort((a, b) => a - b);
    // Oldest first, capped. The cursor advances only over what we actually
    // processed, so a capped run resumes rather than skips.
    const selected = all.slice(0, opts.limit);

    const messages: RawMessage[] = [];
    for (const uid of selected) {
      if (Date.now() > opts.deadline) break;
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) {
        // The message vanished between search() and fetchOne — imapflow resolves
        // `false` for "no such message", so it was almost certainly expunged by
        // another client. Advancing past it is correct: refusing to would retry a
        // deleted message on every run and wedge the integration forever.
        //
        // A TRANSIENT failure does not land here — it throws, and the throw exits
        // before the cursor is saved, so those resume safely on their own.
        //
        // Logged because this branch is the one place a real message could be lost
        // silently (a server returning no body for a message that still exists),
        // and without a line here that loss would be invisible.
        console.warn(`[imap] skipping uid ${uid} in ${cfg.folder}: no message body returned`);
        continue;
      }
      messages.push({ uid, source: msg.source });
    }

    return {
      messages,
      cursor: nextCursor(cursor, uidValidity, messages),
      matchedCount: all.length,
    };
  } finally {
    // logout() can throw on a half-closed socket; the fetch already succeeded
    // by then and failing the run over a noisy goodbye would be wrong.
    await client.logout().catch(() => undefined);
  }
};

/** What a probe is looking for — separate from `ImapConfig`, which is only
 *  how to connect. Filters are what the sync would actually import. */
export interface ProbeFilters {
  fromFilter: string;
  subjectFilter: string;
}

export interface ProbeOpts {
  /** How far back to search, in days. Callers pass bank-sync's
   *  FIRST_RUN_LOOKBACK_DAYS so the count means "what a first sync would
   *  import", not an arbitrary window. */
  sinceDays: number;
}

/** Header fetch is capped so a shared mailbox with a huge from-match can never
 *  turn the test button into a hang. A personal mailbox will never hit this. */
const PROBE_HEADER_FETCH_CAP = 200;

/**
 * The sender ADDRESS from the IMAP ENVELOPE — deliberately not a rendered
 * "Name <addr>" string.
 *
 * `matchesFilters` matches on the parsed address precisely so a display name
 * cannot impersonate the expected sender (see kb-email-parser.ts). Handing it a
 * rendered string here would put the display name back in scope and make the
 * probe count matches the sync then refuses — the exact drift the shared
 * predicate exists to prevent.
 */
function envelopeFromAddress(envelope: MessageEnvelopeObject | undefined): string | null {
  return envelope?.from?.[0]?.address ?? null;
}

/**
 * Verify credentials and report how many messages actually match the
 * integration's filters — not just the folder total (see the design spec:
 * the old `mailboxExists`-only probe couldn't distinguish a working
 * integration from one with a typo'd filter).
 *
 * The subject filter can't be pushed into IMAP SEARCH (diacritics, charset
 * handling varies by server — see kb-email-parser.ts and bank-sync.ts), but
 * `fromFilter` is plain ASCII and indexed, so we search server-side by
 * `from` + `since` and only fetch headers for the (capped) matches to apply
 * the subject filter in code via `matchesFilters` — the exact predicate the
 * sync uses, so the probe and the sync cannot disagree.
 */
export async function probeConnection(
  cfg: ImapConfig,
  filters: ProbeFilters,
  opts: ProbeOpts,
): Promise<
  | { ok: true; mailboxExists: number; fromMatches: number; filterMatches: number; truncated: boolean }
  | { ok: false; error: string }
> {
  const client = clientFor(cfg);
  try {
    await client.connect();
    // readOnly: same invariant as fetchMessagesOverImap — never mark seen,
    // move or delete just because the user clicked "test".
    const mailbox = await client.mailboxOpen(cfg.folder, { readOnly: true });
    const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
    const found = await client.search({ from: filters.fromFilter, since }, { uid: true });

    // search() resolves `false` (not null/undefined) when nothing matches —
    // this exact bug was already found and fixed once in this file, so a
    // plain `?? []` is not enough; narrow it explicitly.
    const all = Array.isArray(found) ? found : [];
    const truncated = all.length > PROBE_HEADER_FETCH_CAP;
    // Newest first, capped.
    const selected = all.slice().sort((a, b) => b - a).slice(0, PROBE_HEADER_FETCH_CAP);

    let filterMatches = 0;
    if (selected.length > 0) {
      // Headers only (envelope), never `source` — the probe needs subject and
      // from, not the body.
      const messages = await client.fetchAll(selected, { envelope: true }, { uid: true });
      for (const msg of messages) {
        const from = envelopeFromAddress(msg.envelope);
        const subject = msg.envelope?.subject ?? '';
        if (matchesFilters(from, subject, filters)) filterMatches++;
      }
    }

    return {
      ok: true,
      mailboxExists: Number(mailbox.exists),
      fromMatches: all.length,
      filterMatches,
      truncated,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await client.logout().catch(() => undefined);
  }
}
