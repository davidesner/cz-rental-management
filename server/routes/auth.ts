import { Hono } from 'hono';
import type { Auth } from '../../core/auth/better-auth.js';
import type { DB } from '../../core/db/client.js';

interface AuthRouteContext {
  Variables: {
    auth: Auth;
    db: DB;
  };
}

export function authRoutes(auth: Auth) {
  const r = new Hono<AuthRouteContext>();
  r.on(['POST', 'GET'], '/auth/*', (c) => auth.handler(c.req.raw as unknown as Request));
  return r;
}
