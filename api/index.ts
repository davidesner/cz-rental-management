// Vercel serverless entrypoint for the Hono API.
// Local development uses `server/node.ts` (long-running @hono/node-server).
//
// On Vercel:
// - `vercel.json` rewrites `/api/*` to this handler
// - DB client uses serverless-safe pool (max: 1, prepare: false)
// - DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL must be set in project env vars
import { handle } from 'hono/vercel';
import { createDb } from '../core/db/client.js';
import { buildApp } from '../server/app.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set');
}

// Module-level init (warm function instances reuse this client)
const { db } = createDb(process.env.DATABASE_URL);
const app = buildApp({ db });

export const runtime = 'nodejs';

export default handle(app);
