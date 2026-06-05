import { Hono } from 'hono';
import { createAuth } from '../core/auth/better-auth.js';
import { errorMiddleware } from './middleware/errors.js';
import { authMiddleware } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { organizationRoutes } from './routes/organizations.js';
import { propertyRoutes } from './routes/properties.js';
import { propertyAccessRoutes } from './routes/property-access.js';
import { apiTokenRoutes } from './routes/api-tokens.js';
import { tenantRoutes } from './routes/tenants.js';
import { contractRoutes } from './routes/contracts.js';
import { contractTermsRoutes } from './routes/contract-terms.js';
import { contractUtilityRoutes } from './routes/contract-utilities.js';
import { propertyTariffRoutes } from './routes/property-tariffs.js';
import { paymentRoutes } from './routes/payments.js';
import { costStatementRoutes } from './routes/cost-statements.js';
import { reconciliationRoutes } from './routes/reconciliations.js';
import type { DB } from '../core/db/client.js';
import type { Auth } from '../core/auth/better-auth.js';
import type { AuthContext } from '../core/auth/context.js';

export interface AppDeps {
  db: DB;
}

export interface AppEnv {
  Variables: {
    auth: Auth;
    db: DB;
    auth_ctx: AuthContext;
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

  // Health check — used by Playwright webServer readiness probe
  app.get('/api/health', (c) => c.json({ ok: true }));

  // Auth routes must remain unauthenticated
  app.route('/api', authRoutes(auth));

  // Gated /api/* (skip the /api/auth/* paths)
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next();
    return authMiddleware()(c, next);
  });

  app.route('/api', meRoutes());
  app.route('/api', organizationRoutes());
  app.route('/api', propertyRoutes());
  app.route('/api', propertyAccessRoutes());
  app.route('/api', apiTokenRoutes());
  app.route('/api', tenantRoutes());
  app.route('/api', contractRoutes());
  app.route('/api', contractTermsRoutes());
  app.route('/api', contractUtilityRoutes());
  app.route('/api', propertyTariffRoutes());
  app.route('/api', paymentRoutes());
  app.route('/api', costStatementRoutes());
  app.route('/api', reconciliationRoutes());

  return app;
}
