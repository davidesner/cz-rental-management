/** Query parameter the OAuth provider uses to list the names it signed. */
const SIGNED_NAMES_PARAM = 'ba_param';

/**
 * The signed OAuth authorization query on the `/login` or `/oauth/consent`
 * page (better-auth sends the user there with `...&exp=..&sig=..` when an AI
 * agent connects to the remote MCP endpoint), or null when the page was not
 * opened by an OAuth authorization. When the query lists the names it signed,
 * anything else on the URL is dropped so a stray parameter cannot break the
 * signature; otherwise it is returned unchanged.
 */
export function oauthQueryFromLocation(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.get('sig')) return null;
  const signed = new Set(params.getAll(SIGNED_NAMES_PARAM));
  if (signed.size === 0) return search.startsWith('?') ? search.slice(1) : search;
  const kept = new URLSearchParams();
  for (const [key, value] of params) {
    if (key === 'sig' || key === SIGNED_NAMES_PARAM || signed.has(key)) kept.append(key, value);
  }
  return kept.toString();
}
