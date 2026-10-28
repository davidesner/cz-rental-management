import { Hono } from 'hono';
import type { Auth } from '../../core/auth/better-auth.js';
import type { DB } from '../../core/db/client.js';

interface AuthRouteContext {
  Variables: {
    auth: Auth;
    db: DB;
  };
}

/**
 * OAuth's authorize endpoint is a front-channel browser navigation. better-auth
 * answers it with a 302, except when the request looks like a script `fetch`
 * (`sec-fetch-mode: cors`): then it returns `200 {"redirect": true, "url"}` for
 * page code to follow.
 *
 * On Vercel, a navigation accepting text/html reaches the function through an
 * internal subrequest that sets `sec-fetch-mode: cors`, so the browser would
 * show that JSON instead of following the redirect (an agent's "Connect" stops
 * there). For exactly that shape - GET, HTML accepted, no explicit JSON - the
 * header is removed before better-auth sees it. Nothing else is rewritten.
 */
export function asAuthorizeNavigation(req: Request): Request {
  if (req.method !== 'GET' || req.headers.get('sec-fetch-mode')?.toLowerCase() !== 'cors') return req;
  const accept = (req.headers.get('accept') ?? '').toLowerCase();
  if (!(accept.includes('text/html') || accept.includes('application/xhtml+xml')) || accept.includes('application/json')) {
    return req;
  }
  const headers = new Headers(req.headers);
  headers.delete('sec-fetch-mode');
  return new Request(req, { headers });
}

export function authRoutes(auth: Auth) {
  const r = new Hono<AuthRouteContext>();
  r.on(['POST', 'GET'], '/auth/*', (c) =>
    auth.handler(c.req.path === '/api/auth/oauth2/authorize' ? asAuthorizeNavigation(c.req.raw) : c.req.raw));
  return r;
}
