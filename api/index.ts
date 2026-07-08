// Vercel serverless entrypoint for the Hono API.
// Local development uses `server/node.ts` (long-running @hono/node-server).
//
// On Vercel:
// - `vercel.json` rewrites `/api/*` to this handler
// - DB client uses serverless-safe pool (max: 1, prepare: false)
// - DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL must be set in project env vars
// `@hono/node-server/vercel` exports a Node.js-style (req, res) => Promise<void>
// handler, matching Vercel's legacy Node.js Functions signature that our
// deployment actually uses. `hono/vercel#handle` returns a fetch-style
// (request) => Response function — that's for Vercel Edge/Fluid Compute and
// silently hangs under the legacy Node.js runtime (see prior deploy: status
// code 0, "default export returned a Response — returns are ignored").
import { handle } from '@hono/node-server/vercel';
import { createDb } from '../core/db/client.js';
import { buildApp } from '../server/app.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set');
}

// Module-level init (warm function instances reuse this client)
const { db } = createDb(process.env.DATABASE_URL);
const app = buildApp({ db });

export default handle(app);
