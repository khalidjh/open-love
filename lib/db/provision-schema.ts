import postgres from 'postgres';

// Provisions a per-project Postgres schema inside the shared (self-hosted)
// Supabase, grants API roles access, and exposes it to PostgREST at runtime so
// the generated frontend can reach it via supabase-js `.schema(name)`.
//
// Uses a privileged connection (DATABASE_URL = postgres superuser locally; in
// production use a dedicated admin role). Schema names are derived from the
// project id and validated, so they are safe to interpolate.

const SUPABASE_INTERNAL_SCHEMAS = 'public, graphql_public';

export function schemaNameForProject(projectId: string): string {
  const slug = projectId.replace(/-/g, '').slice(0, 12).toLowerCase();
  return `proj_${slug}`;
}

function assertSafeIdent(name: string) {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(name)) {
    throw new Error(`Unsafe schema identifier: ${name}`);
  }
}

export async function provisionProjectSchema(projectId: string): Promise<{ schema: string }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const schema = schemaNameForProject(projectId);
  assertSafeIdent(schema);

  const sql = postgres(url, { max: 1 });
  try {
    // 1. Create the schema
    await sql.unsafe(`create schema if not exists "${schema}"`);

    // 2. Grant API roles access. IMPORTANT: end-user roles (anon = the public
    //    browser key, authenticated = a logged-in user) get ONLY schema usage —
    //    never blanket table access. Per-table CRUD is granted by createTables
    //    according to each table's RLS access level, so nothing is world-writable
    //    by default. service_role (server/admin) keeps full access, now + future.
    await sql.unsafe(`grant usage on schema "${schema}" to anon, authenticated, service_role`);
    await sql.unsafe(`grant all on all tables in schema "${schema}" to service_role`);
    await sql.unsafe(`grant all on all sequences in schema "${schema}" to service_role`);
    await sql.unsafe(`alter default privileges in schema "${schema}" grant all on tables to service_role`);
    await sql.unsafe(`alter default privileges in schema "${schema}" grant all on sequences to service_role`);
    // Neutralize any legacy blanket grants to end-user roles from earlier
    // provisioning of this schema, so future tables are not auto-opened to them.
    await sql.unsafe(`alter default privileges in schema "${schema}" revoke all on tables from anon, authenticated`);
    await sql.unsafe(`alter default privileges in schema "${schema}" revoke all on sequences from anon, authenticated`);

    // 3. Expose the schema to PostgREST (read current list, append, reload)
    const rows = await sql<{ cfg: string }[]>`
      select unnest(rolconfig) as cfg from pg_roles where rolname = 'authenticator'
    `;
    const current = rows
      .map((r) => r.cfg)
      .find((c) => c.startsWith('pgrst.db_schemas='));
    const exposed = (current ? current.split('=').slice(1).join('=') : SUPABASE_INTERNAL_SCHEMAS)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!exposed.includes(schema)) {
      exposed.push(schema);
      const value = exposed.join(', ');
      await sql.unsafe(`alter role authenticator set pgrst.db_schemas = '${value}'`);
      await sql.unsafe(`notify pgrst, 'reload config'`);
    }

    return { schema };
  } finally {
    await sql.end();
  }
}

// Best-effort teardown (used if a project's DB is removed).
export async function deprovisionProjectSchema(projectId: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const schema = schemaNameForProject(projectId);
  assertSafeIdent(schema);

  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(`drop schema if exists "${schema}" cascade`);
    const rows = await sql<{ cfg: string }[]>`
      select unnest(rolconfig) as cfg from pg_roles where rolname = 'authenticator'
    `;
    const current = rows.map((r) => r.cfg).find((c) => c.startsWith('pgrst.db_schemas='));
    if (current) {
      const exposed = current.split('=').slice(1).join('=')
        .split(',').map((s) => s.trim()).filter((s) => s && s !== schema);
      await sql.unsafe(`alter role authenticator set pgrst.db_schemas = '${exposed.join(', ')}'`);
      await sql.unsafe(`notify pgrst, 'reload config'`);
    }
  } finally {
    await sql.end();
  }
}
