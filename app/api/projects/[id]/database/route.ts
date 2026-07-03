import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, getProjectDatabase, upsertProjectDatabase, deleteProjectDatabase } from '@/lib/db/repos';
import { provisionProjectSchema, deprovisionProjectSchema } from '@/lib/db/provision-schema';
import { encrypt, decrypt } from '@/lib/crypto';
import { getTemplate, type Framework } from '@/lib/templates';
import { getSession } from '@/lib/sandbox/session-store';

// Best-effort: drop the Supabase creds into the live sandbox and install the
// client so the generated app can read them immediately. Var names + which dev
// server to restart depend on the project's framework (Vite vs Next.js).
// Scoped to THIS project's sandbox session — never a shared global.
async function injectIntoSandbox(projectId: string, url: string, anonKey: string, schema: string, framework: Framework) {
  const provider = getSession(projectId)?.provider;
  if (!provider) return;
  try {
    const t = getTemplate(framework).env;
    const env = `${t.supabaseUrl}=${url}\n${t.supabaseAnonKey}=${anonKey}\n${t.supabaseSchema}=${schema}\n`;
    await provider.writeFile('.env', env);
    await provider.runShell('npm install @supabase/supabase-js');
    if (framework === 'nextjs') await provider.restartNextServer();
    else await provider.restartViteServer();
  } catch (e) {
    console.error('[database] sandbox injection failed', e);
  }
}

// The generated app connects to the shared self-hosted Supabase; only the
// schema differs per project. URL + anon key are public by design.
function sharedConfig() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  };
}

async function requireOwnedProject(id: string) {
  const { orgId } = await requireOrg();
  const project = await getProject(orgId, id);
  return { orgId, project };
}

// GET — current database status for the project
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { project } = await requireOwnedProject(id);
    if (!project) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const rec = await getProjectDatabase(id);
    if (!rec) return NextResponse.json({ success: true, database: null });

    let creds: any = null;
    try { creds = rec.encryptedCredentials ? JSON.parse(decrypt(rec.encryptedCredentials)) : null; } catch {}
    return NextResponse.json({
      success: true,
      database: { status: rec.status, provider: rec.provider, schema: rec.externalRef, ...creds },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

// POST — provision a per-project schema (idempotent)
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { project } = await requireOwnedProject(id);
    if (!project) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    await upsertProjectDatabase(id, { status: 'provisioning' });

    const { schema } = await provisionProjectSchema(id);
    const { url, anonKey } = sharedConfig();

    await upsertProjectDatabase(id, {
      provider: 'supabase',
      externalRef: schema,
      status: 'ready',
      encryptedCredentials: encrypt(JSON.stringify({ url, anonKey, schema })),
    });

    await injectIntoSandbox(id, url, anonKey, schema, (project.framework as Framework) || 'vite');

    return NextResponse.json({ success: true, database: { status: 'ready', schema, url, anonKey } });
  } catch (error) {
    const { id } = await params;
    try { await upsertProjectDatabase(id, { status: 'error' }); } catch {}
    if (error instanceof UnauthorizedError) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

// DELETE — tear down the project's schema
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { project } = await requireOwnedProject(id);
    if (!project) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    await deprovisionProjectSchema(id);
    await deleteProjectDatabase(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
