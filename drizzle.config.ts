import 'dotenv/config';
import type { Config } from 'drizzle-kit';

export default {
  schema: './core/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rental_dev',
  },
} satisfies Config;
