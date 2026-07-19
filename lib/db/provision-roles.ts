import postgres from 'postgres';
import { schemaNameForProject } from './provision-schema';

// Role-based access for generated apps. Adds a per-project `app_members` table
// (user_id, role owner|manager|employee, manager_id) plus SECURITY DEFINER helper
// functions that RLS policies on `org`-access tables call to scope rows by role:
//   • owner    → sees/edits every row
//   • manager  → sees their direct reports' rows (read); edits only their own
//   • employee → sees/edits only their own rows
//
// Roles live in the data layer (not Zitadel claims), so the app manages them with
// no identity-provider round-trips. The first user to sign up becomes `owner`;
// everyone after is an `employee` until the owner promotes them.
//
// Idempotent — safe to run on every build. Runs as the privileged DATABASE_URL role.

// The logged-in user's id (Zitadel `sub`, text) from the request JWT — matches the
// expression used for owner scoping in provision-tables.ts.
const JWT_SUB = "nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub'";

export async function provisionProjectRoles(projectId: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const s = schemaNameForProject(projectId);
  const T = `"${s}"."app_members"`;

  const stmts: string[] = [
    // --- membership table ---
    `create table if not exists ${T} (
       user_id text primary key,
       email text,
       name text,
       role text not null default 'employee'
         constraint app_members_role_chk check (role in ('owner','manager','employee')),
       manager_id text,
       created_at timestamptz not null default now()
     )`,
    // at most one owner row can ever exist (guards a concurrent first-signup race)
    `create unique index if not exists app_members_one_owner on ${T} (role) where role = 'owner'`,

    // --- helper functions (SECURITY DEFINER so policies can consult the roster
    //     without recursing through its own RLS) ---
    `create or replace function "${s}".app_uid() returns text
       language sql stable as $$ select ${JWT_SUB} $$`,
    `create or replace function "${s}".app_role() returns text
       language sql stable security definer set search_path = "${s}", pg_temp as
       $$ select coalesce((select role from ${T} where user_id = "${s}".app_uid()), 'employee') $$`,
    // visibility: own row OR caller is owner OR caller is a manager and the row's
    // owner is one of their direct reports
    `create or replace function "${s}".app_can_see(row_owner text) returns boolean
       language sql stable security definer set search_path = "${s}", pg_temp as
       $$ select row_owner = "${s}".app_uid()
            or exists (select 1 from ${T} me where me.user_id = "${s}".app_uid() and me.role = 'owner')
            or exists (select 1 from ${T} me join ${T} emp on emp.manager_id = me.user_id
                       where me.user_id = "${s}".app_uid() and me.role = 'manager' and emp.user_id = row_owner) $$`,
    // write: own row OR caller is owner (managers edit only their own — decision C)
    `create or replace function "${s}".app_can_write(row_owner text) returns boolean
       language sql stable security definer set search_path = "${s}", pg_temp as
       $$ select row_owner = "${s}".app_uid()
            or exists (select 1 from ${T} me where me.user_id = "${s}".app_uid() and me.role = 'owner') $$`,
    // bootstrap: the caller claims membership; first ever caller becomes owner.
    `create or replace function "${s}".app_claim_membership(p_email text, p_name text) returns text
       language plpgsql security definer set search_path = "${s}", pg_temp as $$
       declare uid text := "${s}".app_uid(); existing text;
       begin
         if uid is null then return null; end if;
         select role into existing from ${T} where user_id = uid;
         if existing is not null then return existing; end if;
         begin
           insert into ${T}(user_id, email, name, role) values (uid, p_email, p_name, 'owner');
           return 'owner';
         exception when unique_violation then
           insert into ${T}(user_id, email, name, role) values (uid, p_email, p_name, 'employee')
             on conflict (user_id) do nothing;
           return coalesce((select role from ${T} where user_id = uid), 'employee');
         end;
       end $$`,

    // --- grants + RLS on the roster itself ---
    `grant all on ${T} to service_role`,
    `revoke all on ${T} from anon`,
    `grant select, insert, update, delete on ${T} to authenticated`,
    `alter table ${T} enable row level security`,
    // any signed-in member can read the roster (needed for assignment dropdowns);
    // `using (true)` also keeps the helper functions cheap and recursion-free.
    `drop policy if exists members_read on ${T}`,
    `create policy members_read on ${T} for select to authenticated using (true)`,
    // only an owner may change roles / managers (the claim RPC bypasses this as a
    // SECURITY DEFINER function, so a brand-new user can still self-register).
    `drop policy if exists members_admin on ${T}`,
    `create policy members_admin on ${T} for all to authenticated
       using ("${s}".app_role() = 'owner') with check ("${s}".app_role() = 'owner')`,

    // functions callable by the API roles
    `grant execute on function "${s}".app_uid(), "${s}".app_role(),
       "${s}".app_can_see(text), "${s}".app_can_write(text),
       "${s}".app_claim_membership(text, text) to anon, authenticated, service_role`,

    `notify pgrst, 'reload schema'`,
  ];

  const sql = postgres(url, { max: 1 });
  try {
    for (const stmt of stmts) await sql.unsafe(stmt);
  } finally {
    await sql.end();
  }
}
