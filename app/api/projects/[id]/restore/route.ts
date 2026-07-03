import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, getLatestVersion } from '@/lib/db/repos';
import { getSession } from '@/lib/sandbox/session-store';

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

    // Install any deps the saved package.json needs, then restart the dev server.
    const hasPackageJson = paths.some((p) => p.endsWith('package.json'));
    if (hasPackageJson) {
      try {
        await provider.runShell('npm install');
      } catch (e) {
        console.error('[restore] npm install failed', e);
      }
    }
    try {
      await provider.restartViteServer();
    } catch (e) {
      console.error('[restore] vite restart failed', e);
    }

    return NextResponse.json({ success: true, restored: written });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
