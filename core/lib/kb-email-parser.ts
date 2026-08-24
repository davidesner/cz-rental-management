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

/**
 * The sender/subject gate, extracted so the sync parser and the connection
 * probe (`probeConnection` in `imap-fetcher.ts`) share exactly one definition
 * of "does this message match". A probe that reimplemented this would drift
 * from the parser over time — reporting matches the sync would not actually
 * import, which is worse than the plain folder total it replaces.
 */
export function matchesFilters(
  from: string,
  subject: string,
  filters: { fromFilter: string; subjectFilter: string },
): boolean {
  return fold(from).includes(fold(filters.fromFilter))
    && fold(subject).includes(fold(filters.subjectFilter));
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

/**
 * True when y/m/d is a real calendar date.
 *
 * DATE_CZ only asserts the SHAPE, so "Splatnost: 32. 13. 2026" would otherwise
 * pass as valueDate '2026-13-32' on an ok:true result. That string then reaches
 * a Postgres `date` column and fails the INSERT — turning a parseable-but-wrong
 * notification into an opaque database error instead of the clean parse_failed
 * row the design promises.
 */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  // Day 0 of month m+1 is the last day of month m.
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
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
  const hasEnDate = tokens.some((t) => DATE_EN.test(t));
  if (!hasEnDate) problems.push('the English mirror block is missing its due date');
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
  if (!isRealDate(Number(czDate[3]), Number(czDate[2]), Number(czDate[1]))) {
    return fail('missing_value_date', `implausible value date in "${czDateToken}"`);
  }
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
  const subject = mail.subject ?? '';
  if (!matchesFilters(fromText, subject, filters)) {
    return bail('not_kb_notification', `sender "${fromText}" or subject "${subject}" does not match filters "${filters.fromFilter}" / "${filters.subjectFilter}"`);
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
