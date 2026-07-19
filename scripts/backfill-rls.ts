/**
 * Backfill RLS on tables provisioned BEFORE per-table access control existed.
 *
 * Context: early generated-app tables were created with a blanket
 * `grant all ... to anon` and NO row-level security, so any visitor could read
 * and write every row via the browser anon key. New tables are now secured at
 * creation (see lib/db/provision-tables.ts). This script hardens the ones that
 * already exist.
 *
 * The honest limit: a pre-existing "private" app's rows carry NO ownership marker,
 * so there is no automated way to retroactively scope them per-user without either
 * breaking the app or orphaning data. This script therefore does what is provably
 * safe, and REPORTS the rest for regeneration / manual review:
 *
 *   • Every provisioned schema: stop future tables from being auto-opened to
 *     anon/authenticated (revoke default privileges) — always safe.
 *   • Apps with NO auth: formalize each table as `public` (RLS on + explicit
 *     public policy). No behavior change — these are genuinely anonymous apps.
 *   • Apps WITH auth + a usable text owner column: owner-scope the table as
 *     `private` (gated behind --secure-owned, since if the column's values don't
 *     match current user ids some users could be locked out of their own rows).
 *   • Apps WITH auth but NO usable owner column: cannot be auto-secured — FLAGGED
 *     in the report as still-exposed; regenerate the app to fix.
 *
 * Usage:
 *   npx tsx scripts/backfill-rls.ts                 # dry run: audit + report only
 *   npx tsx scripts/backfill-rls.ts --apply         # safe tier (schema + public apps)
 *   npx tsx scripts/backfill-rls.ts --apply --secure-owned   # also owner-scope fixable auth apps
 *   npx tsx scripts/backfill-rls.ts --project <id>  # limit to one project
 *   npx tsx scripts/backfill-rls.ts --apply --force # re-run even on already-RLS tables
 *   npx tsx scripts/backfill-rls.ts --verbose       # print every SQL statement
 */
import { config } from 'dotenv';
import postgres from 'postgres';
import {
  schemaNameForProject,
} from '../lib/db/provision-schema';
import {
  securityStatements,
  OWNER_COLUMN_CANDIDATES,
  type TableAccess,
} from '../lib/db/provision-tables';

config({ path: '.env.local' });
config();

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const SECURE_OWNED = args.has('--secure-owned');
const FORCE = args.has('--force');
const VERBOSE = args.has('--verbose');
const projectFlagIdx = process.argv.indexOf('--project');
const ONLY_PROJECT = projectFlagIdx >= 0 ? process.argv[projectFlagIdx + 1] : null;

// Postgres text-ish types that can hold a Zitadel `sub` (a text snowflake).
const TEXT_TYPES = new Set(['text', 'character varying', 'citext', 'varchar']);

type Decision = 'public' | 'private' | 'flag' | 'already-rls' | 'no-schema';
interface Row {
  project: string;
  schema: string;
  table: string;
  hasAuth: boolean;
  ownerCol: string | null;
  ownerType: string | null;
  rows: number | null;
  decision: Decision;
  applied: boolean;
}

function schemaHardenStatements(schema: string): string[] {
  const S = `"${schema}"`;
  return [
    `grant usage on schema ${S} to anon, authenticated, service_role`,
    `grant all on all tables in schema ${S} to service_role`,
    `grant all on all sequences in schema ${S} to service_role`,
    `alter default privileges in schema ${S} grant all on tables to service_role`,
    `alter default privileges in schema ${S} grant all on sequences to service_role`,
    `alter default privileges in schema ${S} revoke all on tables from anon, authenticated`,
    `alter default privileges in schema ${S} revoke all on sequences from anon, authenticated`,
  ];
}

async function main() {
  const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('✗ DIRECT_DATABASE_URL / DATABASE_URL is not set (need the privileged connection).');
    process.exit(1);
  }

  // onnotice: swallow the harmless "policy ... does not exist, skipping" NOTICEs
  // that the idempotent drop-if-exists statements emit.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const report: Row[] = [];

  try {
    // Provisioned projects: a ready database, plus whether auth is ready.
    const projects = await sql<{ id: string; name: string; auth_ready: boolean }[]>`
      select p.id, p.name,
             coalesce(bool_or(au.status = 'ready'), false) as auth_ready
      from projects p
      join tenant_databases db on db.project_id = p.id and db.status = 'ready'
      left join tenant_auth au on au.project_id = p.id
      ${ONLY_PROJECT ? sql`where p.id = ${ONLY_PROJECT}` : sql``}
      group by p.id, p.name
      order by p.created_at asc
    `;

    console.log(
      `\n${APPLY ? '⚙  APPLY' : '🔍 DRY RUN'}${SECURE_OWNED ? ' +secure-owned' : ''} — ${projects.length} provisioned project(s)\n`,
    );

    for (const proj of projects) {
      const schema = schemaNameForProject(proj.id);
      const label = `${proj.name} (${proj.id.slice(0, 8)}) → ${schema}`;

      const [exists] = await sql<{ n: number }[]>`
        select count(*)::int as n from information_schema.schemata where schema_name = ${schema}
      `;
      if (!exists?.n) {
        report.push({ project: label, schema, table: '—', hasAuth: proj.auth_ready, ownerCol: null, ownerType: null, rows: null, decision: 'no-schema', applied: false });
        continue;
      }

      if (APPLY) {
        for (const stmt of schemaHardenStatements(schema)) {
          if (VERBOSE) console.log(`   [schema] ${stmt}`);
          await sql.unsafe(stmt);
        }
      }

      const tables = await sql<{ tablename: string; rls: boolean }[]>`
        select c.relname as tablename, c.relrowsecurity as rls
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = ${schema} and c.relkind = 'r'
        order by c.relname
      `;

      for (const t of tables) {
        // Detect an owner column (best candidate present) and its type.
        const cols = await sql<{ column_name: string; data_type: string }[]>`
          select column_name, data_type
          from information_schema.columns
          where table_schema = ${schema} and table_name = ${t.tablename}
        `;
        const byName = new Map(cols.map((c) => [c.column_name, c.data_type]));
        const ownerCol = OWNER_COLUMN_CANDIDATES.find((c) => byName.has(c)) ?? null;
        const ownerType = ownerCol ? byName.get(ownerCol)! : null;
        const usableOwner = ownerCol !== null && TEXT_TYPES.has(ownerType!);

        let decision: Decision;
        let access: TableAccess | null = null;
        let applyTier: 'safe' | 'owned' | 'none';

        if (t.rls && !FORCE) {
          decision = 'already-rls';
          applyTier = 'none';
        } else if (!proj.auth_ready) {
          decision = 'public'; // anonymous app — formalize; no behavior change
          access = 'public';
          applyTier = 'safe';
        } else if (usableOwner) {
          decision = 'private'; // auth app with an owner tag — owner-scope it
          access = 'private';
          applyTier = 'owned';
        } else {
          decision = 'flag'; // auth app, no way to scope automatically
          applyTier = 'none';
        }

        let rows: number | null = null;
        if (decision === 'private' || decision === 'flag') {
          const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(schema)}.${sql(t.tablename)}`;
          rows = n;
        }

        let applied = false;
        const willApply = APPLY && (applyTier === 'safe' || (applyTier === 'owned' && SECURE_OWNED));
        if (willApply && access) {
          for (const stmt of securityStatements(schema, t.tablename, access, ownerCol ?? 'user_id')) {
            if (VERBOSE) console.log(`   [${t.tablename}] ${stmt}`);
            await sql.unsafe(stmt);
          }
          applied = true;
        }

        report.push({ project: label, schema, table: t.tablename, hasAuth: proj.auth_ready, ownerCol, ownerType, rows, decision, applied });
      }
    }

    printReport(report);
  } finally {
    await sql.end();
  }
}

function printReport(report: Row[]) {
  const exposedFixable = report.filter((r) => r.decision === 'private');
  const exposedManual = report.filter((r) => r.decision === 'flag');
  const publicApps = report.filter((r) => r.decision === 'public');
  const alreadyRls = report.filter((r) => r.decision === 'already-rls');
  const noSchema = report.filter((r) => r.decision === 'no-schema');

  const line = (r: Row) =>
    `   • ${r.schema}.${r.table}` +
    (r.ownerCol ? `  owner=${r.ownerCol}:${r.ownerType}` : '') +
    (r.rows !== null ? `  rows=${r.rows}` : '') +
    (r.applied ? '  ✅ secured' : '');

  if (exposedManual.length) {
    console.log(`\n🔴 EXPOSED — auth app, NO usable owner column (cannot auto-secure; regenerate the app):`);
    exposedManual.forEach((r) => console.log(line(r)));
  }
  if (exposedFixable.length) {
    console.log(`\n🟠 EXPOSED — auth app with an owner column (${SECURE_OWNED ? 'securing now' : 'run with --secure-owned to fix'}):`);
    exposedFixable.forEach((r) => console.log(line(r)));
  }
  if (publicApps.length) {
    console.log(`\n🟢 Public/anonymous apps — formalized as public (no private data, no behavior change):`);
    publicApps.forEach((r) => console.log(line(r)));
  }
  if (alreadyRls.length) {
    console.log(`\n✓ Already had RLS (skipped${FORCE ? '' : '; use --force to re-apply'}): ${alreadyRls.length} table(s)`);
  }
  if (noSchema.length) {
    console.log(`\n⚠ Ready DB record but schema missing: ${noSchema.map((r) => r.schema).join(', ')}`);
  }

  console.log(`\n── Summary ─────────────────────────────`);
  console.log(`   exposed, needs regen : ${exposedManual.length}`);
  console.log(`   exposed, ${SECURE_OWNED ? 'secured now' : 'fixable w/ flag'} : ${exposedFixable.length}`);
  console.log(`   public (formalized)  : ${publicApps.length}`);
  console.log(`   already had RLS      : ${alreadyRls.length}`);
  console.log(`   secured this run     : ${report.filter((r) => r.applied).length}`);
  if (!APPLY) console.log(`\n   (dry run — nothing changed. Re-run with --apply to execute.)`);
  console.log('');
}

main().catch((e) => {
  console.error('✗ backfill failed:', e);
  process.exit(1);
});
