import postgres from 'postgres';
import { schemaNameForProject } from './provision-schema';

// File storage for generated apps. Creates a PRIVATE per-project bucket and RLS
// policies on storage.objects scoped to it, mirroring the table access model:
//   • org     — role-based (owner sees all files, manager sees team's, employee own),
//               reusing the app_members helper functions from provision-roles.
//   • private — each user sees/manages only files they uploaded.
//   • public  — anyone (even anonymous) can read/write.
// Verified against prod storage: storage-api stores the uploader's text `sub` in
// storage.objects.owner_id, so the same text-sub scoping used for tables applies.
//
// The bucket is created by direct SQL (idempotent) rather than the storage API.

const JWT_SUB = "nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub'";

export type FileAccess = 'org' | 'private' | 'public';

// Bucket id = the project's schema name (a validated proj_<slug> identifier).
export function bucketForProject(projectId: string): string {
  return schemaNameForProject(projectId);
}

export async function provisionProjectStorage(
  projectId: string,
  access: FileAccess,
): Promise<{ bucket: string }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const s = schemaNameForProject(projectId);
  const bucket = s;
  const pfx = `stor_${s}`; // per-project policy-name prefix (storage.objects is shared)
  const inBucket = `bucket_id = '${bucket}'`;

  const sql = postgres(url, { max: 1 });
  try {
    // Private bucket — access is enforced entirely by the RLS policies below.
    await sql`insert into storage.buckets (id, name, public) values (${bucket}, ${bucket}, false)
              on conflict (id) do nothing`;

    // Reset our policies so re-provisioning at a different access level is clean.
    for (const p of ['sel', 'ins', 'upd', 'del']) {
      await sql.unsafe(`drop policy if exists "${pfx}_${p}" on storage.objects`);
    }

    if (access === 'public') {
      await sql.unsafe(`create policy "${pfx}_sel" on storage.objects for select to anon, authenticated using (${inBucket})`);
      await sql.unsafe(`create policy "${pfx}_ins" on storage.objects for insert to anon, authenticated with check (${inBucket})`);
      await sql.unsafe(`create policy "${pfx}_upd" on storage.objects for update to anon, authenticated using (${inBucket}) with check (${inBucket})`);
      await sql.unsafe(`create policy "${pfx}_del" on storage.objects for delete to anon, authenticated using (${inBucket})`);
    } else if (access === 'org') {
      const canSee = `"${s}".app_can_see(owner_id)`;
      const canWrite = `"${s}".app_can_write(owner_id)`;
      await sql.unsafe(`create policy "${pfx}_sel" on storage.objects for select to authenticated using (${inBucket} and ${canSee})`);
      await sql.unsafe(`create policy "${pfx}_ins" on storage.objects for insert to authenticated with check (${inBucket} and owner_id = ${JWT_SUB})`);
      await sql.unsafe(`create policy "${pfx}_upd" on storage.objects for update to authenticated using (${inBucket} and ${canWrite}) with check (${inBucket} and ${canWrite})`);
      await sql.unsafe(`create policy "${pfx}_del" on storage.objects for delete to authenticated using (${inBucket} and ${canWrite})`);
    } else {
      // private: only the uploader (owner_id = sub) touches their files. anon excluded.
      const own = `owner_id = ${JWT_SUB}`;
      await sql.unsafe(`create policy "${pfx}_sel" on storage.objects for select to authenticated using (${inBucket} and ${own})`);
      await sql.unsafe(`create policy "${pfx}_ins" on storage.objects for insert to authenticated with check (${inBucket} and ${own})`);
      await sql.unsafe(`create policy "${pfx}_upd" on storage.objects for update to authenticated using (${inBucket} and ${own}) with check (${inBucket} and ${own})`);
      await sql.unsafe(`create policy "${pfx}_del" on storage.objects for delete to authenticated using (${inBucket} and ${own})`);
    }
    return { bucket };
  } finally {
    await sql.end();
  }
}
