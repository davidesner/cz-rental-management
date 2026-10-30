/**
 * Vercel appends the named captures of a rewrite source (`/api/:path*`) to the
 * destination as query parameters, so `/api/auth/x?a=1` can reach the function
 * as `/api/auth/x?a=1&path=auth/x`. That breaks anything signed over the query
 * string - the OAuth authorize query of the remote MCP flow. vercel.json uses
 * unnamed groups so nothing is injected; this is the second line of defence.
 *
 * A `path` parameter is removed ONLY when its value is exactly the pathname
 * with the rewrite prefix (`/api/` or `/.well-known/`) removed, which is what
 * the injection produces. A caller-supplied `path` with any other value stays.
 * Takes and returns a request target (`/path?query`), as Node's `req.url`.
 */
const PREFIXES = ['/api/', '/.well-known/'];

export function stripInjectedPathParam(target: string): string {
  const url = new URL(target, 'http://x');
  if (!url.searchParams.has('path')) return target;
  const captured = PREFIXES.flatMap((p) => (url.pathname.startsWith(p) ? [url.pathname.slice(p.length)] : []));
  if (!url.searchParams.getAll('path').some((v) => captured.includes(v))) return target;
  const kept = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (k === 'path' && captured.includes(v)) continue;
    kept.append(k, v);
  }
  const search = kept.toString();
  return `${url.pathname}${search ? `?${search}` : ''}`;
}
