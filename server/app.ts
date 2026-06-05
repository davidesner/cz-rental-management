import { Hono } from 'hono';
import { createAuth } from '../core/auth/better-auth.js';
import { errorMiddleware } from './middleware/errors.js';
import { authRoutes } from './routes/auth.js';
import type { DB } from '../core/db/client.js';
import type { Auth } from '../core/auth/better-auth.js';

export interface AppDeps {
  db: DB;
}

interface AppEnv {
  Variables: {
    auth: Auth;
    db: DB;
  };
}

type HonoApp = Hono<AppEnv>;

export function buildApp(deps: AppDeps): HonoApp {
  const app = new Hono<AppEnv>();
  const auth = createAuth(deps.db);

  app.onError(errorMiddleware);

  app.use('*', async (c, next) => {
    c.set('auth', auth);
    c.set('db', deps.db);
    await next();
  });

  app.route('/api', authRoutes(auth));

  return app;
}
