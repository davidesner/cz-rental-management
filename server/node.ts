import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createDb } from '../core/db/client.js';
import { buildApp } from './app.js';

const url = process.env.DATABASE_URL ?? 'file:./data/rental.sqlite';
const { db } = createDb(url);
const app = buildApp({ db });

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`rental-management listening on http://localhost:${port}`);
});
