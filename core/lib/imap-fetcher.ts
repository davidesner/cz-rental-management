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

/** Verify credentials and report the folder's total message count (mailbox.exists). */
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
