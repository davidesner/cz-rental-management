// Vercel serverless entrypoint for the Hono API.
// Local development uses `server/node.ts` (long-running @hono/node-server).
//
// Body-read shim: @hono/node-server/vercel v1.19 has three body-construction
// paths for POST/PUT/etc.
//   1. incoming.rawBody Buffer   → fast path
//   2. incoming[wrapBodyStream]  → Cloudflare-style
//   3. Readable.toWeb(incoming)  → fallback
// Vercel's modern Node.js runtime hits path 3 with an IncomingMessage-like
// object that isn't a real Readable — `Readable.toWeb` produces a stream that
// never closes, so POSTs hang while GETs (no body read) work. We pre-read the
// body via async iteration and attach it as `rawBody` to force path 1.
import { handle } from '@hono/node-server/vercel';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createDb } from '../core/db/client.js';
import { buildApp } from '../server/app.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set');
}

// Module-level init (warm function instances reuse this client)
const { db } = createDb(process.env.DATABASE_URL);
const app = buildApp({ db });
const honoHandler = handle(app);

type ReqWithRawBody = IncomingMessage & { rawBody?: Buffer };

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default async function vercelHandler(req: ReqWithRawBody, res: ServerResponse) {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD' && !(req.rawBody instanceof Buffer)) {
    try {
      req.rawBody = await readBody(req);
    } catch (err) {
      res.statusCode = 400;
      res.end(`bad request body: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }
  return honoHandler(req, res);
}
