import 'dotenv/config';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDb } from './client.js';

const url = process.env.DATABASE_URL ?? 'file:./data/rental.sqlite';
const { db, client } = createDb(url);

await migrate(db, { migrationsFolder: './drizzle' });
console.log('migrations applied to', url);
client.close();
