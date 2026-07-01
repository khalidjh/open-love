import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Use the DIRECT connection string for migrations (not the pgbouncer pooler).
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || '',
  },
});
