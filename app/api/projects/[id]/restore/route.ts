import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, getLatestVersion, getProjectDatabase } from '@/lib/db/repos';
import { getSession } from '@/lib/sandbox/session-store';
import { writeSandboxEnv } from '@/lib/sandbox/write-sandbox-env';
import { injectSupabaseIntoSandbox } from '@/lib/sandbox/inject-supabase';
import { type Framework } from '@/lib/templates';

// POST /api/projects/:id/restore
// Writes the project's latest saved files into the currently-active sandbox,
// installs deps, and restarts the dev server. The client must have created a
// fresh sandbox first (via create-ai-sandbox-v2).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireOrg();
    const { id } = await params;

    const project = await getProject(orgId, id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const provider = getSession(id)?.provider;
    if (!provider) {
      return NextResponse.json(
        { success: false, error: 'No active sandbox to restore into' },
        { status: 400 }
      );
    }

    const version = await getLatestVersion(id);
    const files = (version?.files ?? {}) as Record<string, string>;
    const paths = Object.keys(files);
    if (paths.length === 0) {
      return NextResponse.json({ success: true, restored: 0, message: 'No saved files' });
    }

    // Write every saved file into the sandbox (overwriting the fresh scaffold).
    let written = 0;
    for (const path of paths) {
      try {
        await provider.writeFile(path, files[path]);
        written++;
      } catch (e) {
        console.error('[restore] failed to write', path, e);
      }
    }

    // Mirror the restored files into the session's cache. Leaving it empty
    // meant the next apply seeded it with ONLY that turn's files, and any later
    // sandbox recovery rebuilt from that partial set — losing the rest of the
    // app.
    const session = getSession(id);
    if (session) {
      session.fileCache = {
        files: Object.fromEntries(paths.map((p) => [p, { content: files[p], lastModified: Date.now() }])),
        lastSync: Date.now(),
        sandboxId: session.sandboxData?.sandboxId ?? '',
      };
      session.existingFiles = new Set([...session.existingFiles, ...paths]);
    }

    // Install any deps the saved package.json needs.
    const hasPackageJson = paths.some((p) => p.endsWith('package.json'));
    if (hasPackageJson) {
      try {
        await provider.runShell('npm install');
      } catch (e) {
        console.error('[restore] npm install failed', e);
      }
    }

    // Re-establish capabilities that live OUTSIDE the saved files. The Supabase
    // client dependency is installed out-of-band (never captured reliably in the
    // saved package.json), so a DB-enabled project must re-run that injection or its
    // lib/supabaseClient.js import fails to resolve — the "Module not found" build
    // error on restore. injectSupabaseIntoSandbox also rewrites .env and restarts the
    // right dev server for the framework.
    const framework = (project.framework as Framework) || 'vite';
    const dbRec = await getProjectDatabase(id);
    if (dbRec?.status === 'ready') {
      await injectSupabaseIntoSandbox(id, framework);
    } else {
      // No database — still refresh .env (auth/AI creds) and restart the correct
      // dev server for this framework (Vite restart on a Next app was a latent bug).
      try {
        await writeSandboxEnv(id, framework);
        if (framework === 'nextjs') await provider.restartNextServer();
        else await provider.restartViteServer();
      } catch (e) {
        console.error('[restore] env/server restart failed', e);
      }
    }

    return NextResponse.json({ success: true, restored: written });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
