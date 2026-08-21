// The bank symbols (VS/KS/SS) as one compact line, for a table cell that has no
// room for three columns.
//
// Deliberately a separate implementation from core/services/bank-sync.ts's
// buildDescription, which builds the same shape for payment.description:
// `@core/*` is in tsconfig.json but absent from vite.config.ts's aliases, so
// importing it here would typecheck and then fail `vite build`. The two are
// allowed to differ — that one is a stored description, this one is a display
// string — so this is not a guard being duplicated.

export interface PaymentSymbols {
  vs: string | null;
  ks: string | null;
  ss: string | null;
}

/** `'VS 123 · KS 0308'`, or null when there is nothing to show. */
export function formatSymbols(p: PaymentSymbols): string | null {
  const parts = [
    p.vs ? `VS ${p.vs}` : null,
    p.ks ? `KS ${p.ks}` : null,
    p.ss ? `SS ${p.ss}` : null,
  ].filter((s): s is string => s !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}
