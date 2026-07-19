import postgres from 'postgres';
import { schemaNameForProject } from './provision-schema';
import { provisionProjectRoles } from './provision-roles';

// Creates tables inside a project's schema from a STRUCTURED spec (never raw
// AI SQL). Identifiers are validated and column types come from a whitelist,
// so nothing user/AI-supplied is interpolated unchecked.
//
// SECURITY: every table gets Row-Level Security enabled. What the public browser
// key (`anon`) and a logged-in end user (`authenticated`) may read/write is
// decided by the table's `access` level — NOT left wide open. Without this,
// every "private" app shipped the anon key and let any visitor read/write every
// row of every table. See `securityStatements`.

// private     — owner-only (each row scoped to the user who created it)
// public_read — anyone reads, signed-in owner writes
// public      — open to anyone (even anonymous)
// org         — role-based: owner sees/edits all, manager sees their team (reads),
//               employee sees/edits own. Requires the roles infra (see provision-roles).
export type TableAccess = 'private' | 'public_read' | 'public' | 'org';

export interface ColumnSpec {
  name: string;
  type: string;
  nullable?: boolean;
  default?: string | number | boolean;
}
export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
  access?: TableAccess;
}

const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const RESERVED = new Set(['id', 'created_at', 'user_id']); // added / managed automatically

// friendly type -> postgres type
const TYPE_MAP: Record<string, string> = {
  text: 'text', string: 'text', varchar: 'text',
  int: 'integer', integer: 'integer', number: 'integer',
  bigint: 'bigint',
  bool: 'boolean', boolean: 'boolean',
  float: 'numeric', double: 'numeric', numeric: 'numeric', decimal: 'numeric',
  uuid: 'uuid',
  json: 'jsonb', jsonb: 'jsonb',
  timestamp: 'timestamptz', timestamptz: 'timestamptz', datetime: 'timestamptz',
  date: 'date',
};

// The logged-in end user's id, read from the request JWT that PostgREST verifies
// against the combined JWKS. This is the Zitadel `sub` — a text snowflake, NOT a
// uuid, so `auth.uid()` (which casts to uuid) would fail here; we keep it as text.
// Resolves to NULL for anonymous (anon-key) requests, which owner-scoped policies
// then reject. Safe to inline: no user/AI input touches this string.
const JWT_SUB = "nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub'";

// Every policy we manage is dropped-if-exists before (re)creating the ones the
// current access level needs, so changing a table's access re-provisions cleanly.
const MANAGED_POLICIES = [
  'etlaq_public_all',
  'etlaq_read_all',
  'etlaq_owner_ins',
  'etlaq_owner_upd',
  'etlaq_owner_del',
  'etlaq_owner_all',
  'etlaq_org_sel',
  'etlaq_org_ins',
  'etlaq_org_upd',
  'etlaq_org_del',
];

function ownerScoped(access: TableAccess): boolean {
  return access === 'private' || access === 'public_read' || access === 'org';
}

// Column names that plausibly tag a row's owner, best first. Used by the backfill
// to owner-scope pre-existing tables that were created before RLS was enforced.
export const OWNER_COLUMN_CANDIDATES = ['user_id', 'owner_id', 'created_by', 'author_id', 'uid'];

// information_schema.data_type values a text JWT sub can be compared against. An
// owner column of any other type (notably `uuid` from old supabase.auth apps)
// can never equal the Zitadel text sub, so we must NOT build a policy on it.
const TEXT_OWNER_TYPES = new Set(['text', 'character varying']);

// Validate the requested access and downgrade owner-scoped levels to `public`
// when the app has no working sign-in (no authenticated user can ever exist, so
// a private table would deny everyone and silently break the app).
function resolveAccess(
  raw: unknown,
  fallback: TableAccess,
  allowOwnerScoped: boolean,
): TableAccess {
  let access: TableAccess =
    raw === 'private' || raw === 'public_read' || raw === 'public' || raw === 'org' ? raw : fallback;
  if (!allowOwnerScoped && ownerScoped(access)) access = 'public';
  return access;
}

function columnDefault(pgType: string, def: ColumnSpec['default']): string | null {
  if (def === undefined || def === null) return null;
  if (pgType === 'boolean') return def === true || def === 'true' ? 'true' : 'false';
  if (pgType === 'integer' || pgType === 'bigint' || pgType === 'numeric') {
    return Number.isFinite(Number(def)) ? String(Number(def)) : null;
  }
  if (pgType === 'timestamptz' && String(def).toLowerCase().includes('now')) return 'now()';
  if (pgType === 'text') return `'${String(def).replace(/'/g, "''")}'`;
  return null;
}

function buildCreateTable(schema: string, table: TableSpec, access: TableAccess): string {
  if (!IDENT.test(table.name)) throw new Error(`Invalid table name: ${table.name}`);
  const cols: string[] = [
    `"id" uuid primary key default gen_random_uuid()`,
  ];
  for (const c of table.columns) {
    if (!IDENT.test(c.name)) throw new Error(`Invalid column name: ${c.name}`);
    if (RESERVED.has(c.name)) continue; // id/created_at/user_id are automatic
    const pgType = TYPE_MAP[String(c.type).toLowerCase()];
    if (!pgType) throw new Error(`Unsupported column type: ${c.type}`);
    let def = `"${c.name}" ${pgType}`;
    if (c.nullable === false) def += ' not null';
    const d = columnDefault(pgType, c.default);
    if (d !== null) def += ` default ${d}`;
    cols.push(def);
  }
  // Owner-scoped tables carry an automatic "user_id" tagged with the logged-in
  // user, so RLS can filter rows by owner. The app never sets it (default fills it).
  if (ownerScoped(access)) {
    cols.push(`"user_id" text not null default (${JWT_SUB})`);
  }
  cols.push(`"created_at" timestamptz not null default now()`);
  return `create table if not exists "${schema}"."${table.name}" (${cols.join(', ')})`;
}

// The grants + RLS policies for one table, keyed by its access level. Idempotent:
// end-user grants are reset and all managed policies dropped first, so a table can
// be re-provisioned at a different access level without leftovers. `ownerColumn` is
// the row-owner column the owner-scoped policies filter on — always "user_id" for
// freshly created tables, but the backfill passes a pre-existing table's column.
export function securityStatements(
  schema: string,
  table: string,
  access: TableAccess,
  ownerColumn: string = 'user_id',
): string[] {
  const T = `"${schema}"."${table}"`;
  const owner = `"${ownerColumn}"`;
  const stmts: string[] = [
    `alter table ${T} enable row level security`,
    // service_role runs server/admin tasks; it keeps full access (and bypasses RLS).
    `grant select, insert, update, delete on ${T} to service_role`,
    // Reset end-user grants + our policies so an access change re-provisions cleanly.
    `revoke all on ${T} from anon, authenticated`,
    ...MANAGED_POLICIES.map((p) => `drop policy if exists "${p}" on ${T}`),
  ];

  if (access === 'public') {
    // Open: anyone (even without an account) can read and write. For genuinely
    // shared, non-personal data only (guestbook, contact form, anonymous poll).
    stmts.push(`grant select, insert, update, delete on ${T} to anon, authenticated`);
    stmts.push(
      `create policy "etlaq_public_all" on ${T} for all to anon, authenticated using (true) with check (true)`,
    );
  } else if (access === 'public_read') {
    // Anyone reads; only a signed-in user may write, and only their own rows.
    stmts.push(`grant select on ${T} to anon`);
    stmts.push(`grant select, insert, update, delete on ${T} to authenticated`);
    stmts.push(
      `create policy "etlaq_read_all" on ${T} for select to anon, authenticated using (true)`,
    );
    stmts.push(
      `create policy "etlaq_owner_ins" on ${T} for insert to authenticated with check (${owner} = ${JWT_SUB})`,
    );
    stmts.push(
      `create policy "etlaq_owner_upd" on ${T} for update to authenticated using (${owner} = ${JWT_SUB}) with check (${owner} = ${JWT_SUB})`,
    );
    stmts.push(
      `create policy "etlaq_owner_del" on ${T} for delete to authenticated using (${owner} = ${JWT_SUB})`,
    );
  } else if (access === 'org') {
    // Role-based (see provision-roles). Visibility/edit rights come from the
    // app_members roster via helper functions, so owner/manager/employee are
    // enforced in the database. anon gets nothing (org data always requires login).
    const canSee = `"${schema}".app_can_see(${owner})`;
    const canWrite = `"${schema}".app_can_write(${owner})`;
    stmts.push(`grant select, insert, update, delete on ${T} to authenticated`);
    stmts.push(`create policy "etlaq_org_sel" on ${T} for select to authenticated using (${canSee})`);
    stmts.push(`create policy "etlaq_org_ins" on ${T} for insert to authenticated with check (${owner} = ${JWT_SUB})`);
    stmts.push(`create policy "etlaq_org_upd" on ${T} for update to authenticated using (${canWrite}) with check (${canWrite})`);
    stmts.push(`create policy "etlaq_org_del" on ${T} for delete to authenticated using (${canWrite})`);
  } else {
    // private: only the signed-in owner can see or change their own rows. anon
    // gets NO grant and NO policy, so the public key can't touch the table at all.
    stmts.push(`grant select, insert, update, delete on ${T} to authenticated`);
    stmts.push(
      `create policy "etlaq_owner_all" on ${T} for all to authenticated using (${owner} = ${JWT_SUB}) with check (${owner} = ${JWT_SUB})`,
    );
  }
  return stmts;
}

export async function createTables(
  projectId: string,
  tables: TableSpec[],
  opts: { defaultAccess?: TableAccess; allowOwnerScoped?: boolean } = {},
): Promise<{ created: string[]; warnings: string[] }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const schema = schemaNameForProject(projectId);
  const allowOwnerScoped = opts.allowOwnerScoped !== false; // default true
  const fallback = resolveAccess(opts.defaultAccess, 'public', allowOwnerScoped);

  // Any `org` table's policies call the app_members helper functions, so the roles
  // infra must exist first. Provision it once up front (idempotent).
  const resolved = tables.map((t) => resolveAccess(t.access, fallback, allowOwnerScoped));
  if (resolved.includes('org')) await provisionProjectRoles(projectId);

  const sql = postgres(url, { max: 1 });
  const created: string[] = [];
  const warnings: string[] = [];
  try {
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      let access = resolved[i];
      await sql.unsafe(buildCreateTable(schema, table, access));

      // Owner-scoped policies filter on a text "user_id". buildCreateTable adds it
      // for a freshly created table, but a table that ALREADY existed (an edit that
      // re-declares it) may lack it or have it as an incompatible type. Reconcile
      // here so we never leave the table half-secured with a policy that references
      // a missing/mismatched column (which would deny everyone — RLS on, no working
      // policy). This is the same "flag, don't break" rule the backfill uses.
      if (ownerScoped(access)) {
        const [col] = await sql<{ data_type: string }[]>`
          select data_type from information_schema.columns
          where table_schema = ${schema} and table_name = ${table.name} and column_name = 'user_id'
        `;
        if (!col) {
          // Pre-existing table with no owner column: add a nullable one (not-null
          // would fail on existing rows). New rows get auto-tagged; any old rows
          // are simply unowned.
          await sql.unsafe(
            `alter table "${schema}"."${table.name}" add column if not exists "user_id" text default (${JWT_SUB})`,
          );
        } else if (!TEXT_OWNER_TYPES.has(col.data_type)) {
          // e.g. an old uuid user_id: can't match the text sub, so owner-scoping
          // would lock every user out. Keep the table usable (public) and flag it.
          access = 'public';
          warnings.push(
            `Table "${table.name}" has a ${col.data_type} user_id that can't be owner-scoped; kept public — regenerate it to make it private.`,
          );
        }
      }

      for (const stmt of securityStatements(schema, table.name, access, 'user_id')) {
        await sql.unsafe(stmt);
      }
      created.push(table.name);
    }
    // Tell PostgREST to reload its schema cache so the new tables are queryable
    await sql.unsafe(`notify pgrst, 'reload schema'`);
    return { created, warnings };
  } finally {
    await sql.end();
  }
}
