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
