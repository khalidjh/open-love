import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Control-plane database (Supabase Postgres). Uses the pooled connection string.
// Set DATABASE_URL in .env.local — use Supabase's "Connection pooling" URI
// (port 6543, ?pgbouncer=true) for serverless-friendly connections.

declare global {
  // eslint-disable-next-line no-var
  var _pgClient: ReturnType<typeof postgres> | undefined;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('[db] DATABASE_URL is not set — database features are disabled.');
}

// Reuse the client across hot reloads / lambda invocations.
const client =
  global._pgClient ??
  (connectionString
    ? postgres(connectionString, { prepare: false, max: 5 })
    : (undefined as unknown as ReturnType<typeof postgres>));

if (process.env.NODE_ENV !== 'production' && connectionString) {
  global._pgClient = client;
}

export const db: PostgresJsDatabase<typeof schema> = client
  ? drizzle(client, { schema })
  : (null as unknown as PostgresJsDatabase<typeof schema>);
export { schema };
