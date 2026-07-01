import postgres from 'postgres';
import { schemaNameForProject } from './provision-schema';

// Creates tables inside a project's schema from a STRUCTURED spec (never raw
// AI SQL). Identifiers are validated and column types come from a whitelist,
// so nothing user/AI-supplied is interpolated unchecked.

export interface ColumnSpec {
  name: string;
  type: string;
  nullable?: boolean;
  default?: string | number | boolean;
}
export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
}

const IDENT = /^[a-z][a-z0-9_]{0,62}$/;
const RESERVED = new Set(['id', 'created_at']); // added automatically

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

function buildCreateTable(schema: string, table: TableSpec): string {
  if (!IDENT.test(table.name)) throw new Error(`Invalid table name: ${table.name}`);
  const cols: string[] = [
    `"id" uuid primary key default gen_random_uuid()`,
  ];
  for (const c of table.columns) {
    if (!IDENT.test(c.name)) throw new Error(`Invalid column name: ${c.name}`);
    if (RESERVED.has(c.name)) continue; // id/created_at are automatic
    const pgType = TYPE_MAP[String(c.type).toLowerCase()];
    if (!pgType) throw new Error(`Unsupported column type: ${c.type}`);
    let def = `"${c.name}" ${pgType}`;
    if (c.nullable === false) def += ' not null';
    const d = columnDefault(pgType, c.default);
    if (d !== null) def += ` default ${d}`;
    cols.push(def);
  }
  cols.push(`"created_at" timestamptz not null default now()`);
  return `create table if not exists "${schema}"."${table.name}" (${cols.join(', ')})`;
}

export async function createTables(
  projectId: string,
  tables: TableSpec[]
): Promise<{ created: string[] }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const schema = schemaNameForProject(projectId);
  const roles = 'anon, authenticated, service_role';

  const sql = postgres(url, { max: 1 });
  const created: string[] = [];
  try {
    for (const table of tables) {
      const ddl = buildCreateTable(schema, table);
      await sql.unsafe(ddl);
      // Grant API roles CRUD access to the new table + its sequences
      await sql.unsafe(`grant all on "${schema}"."${table.name}" to ${roles}`);
      created.push(table.name);
    }
    // Tell PostgREST to reload its schema cache so the new tables are queryable
    await sql.unsafe(`notify pgrst, 'reload schema'`);
    return { created };
  } finally {
    await sql.end();
  }
}
