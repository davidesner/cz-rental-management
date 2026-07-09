// Vercel serverless entrypoint for the Hono API.
// Local development uses `server/node.ts` (long-running @hono/node-server).
//
// Diagnostic build: raw fetch-style handler (`(request: Request) => Response`)
// with explicit runtime declaration. Vercel Functions v2 nodejs runtime should
// give us a Web Request. Previous adapter-based attempts hung on POST body reads
// on the stable production URL but worked via _vercel_share bypass — indicating
// the request object shape differs between routing paths. Bypassing the
// @hono/node-server adapter and going straight to app.fetch removes ambiguity.
import { createDb } from '../core/db/client.js';
import { buildApp } from '../server/app.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set');
}

const { db } = createDb(process.env.DATABASE_URL);
const app = buildApp({ db });

export const runtime = 'nodejs';

export default async function handler(request: Request): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  // stderr goes to Vercel runtime logs; helps diagnose the POST hang.
  console.log(`[api] ${request.method} ${url.pathname} start`);
  try {
    const response = await app.fetch(request);
    console.log(`[api] ${request.method} ${url.pathname} → ${response.status} in ${Date.now() - started}ms`);
    return response;
  } catch (err) {
    console.error(`[api] ${request.method} ${url.pathname} threw in ${Date.now() - started}ms:`, err);
    throw err;
  }
}
