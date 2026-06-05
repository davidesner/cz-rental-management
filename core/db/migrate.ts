import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rental_dev';
const { db, close } = createDb(url);

await migrate(db, { migrationsFolder: './drizzle' });
console.log('migrations applied to', url);
await close();
