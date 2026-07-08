// Vercel serverless entrypoint for the Hono API.
// Local development uses `server/node.ts` (long-running @hono/node-server).
//
// Experiment: `hono/vercel` returns a fetch-style (Request) => Response handler.
// Vercel's modern Node.js Functions runtime supports fetch-style natively when
// the file exports `runtime` at the top level. `@hono/node-server/vercel`'s
// (req, res) Node-style handler worked for GETs but hung for POSTs — likely
// because Vercel's runtime is fetch-style and our req/res handler couldn't
// read the streamed request body.
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
