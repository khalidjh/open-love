import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, getProjectDatabase } from '@/lib/db/repos';
import { provisionProjectStorage, type FileAccess } from '@/lib/db/provision-storage';
import { injectStorageIntoSandbox } from '@/lib/sandbox/inject-storage';
import { type Framework } from '@/lib/templates';

// POST /api/projects/:id/database/storage?access=org|private|public
// Provision a private per-project bucket + RLS policies and inject the etlaqFiles
// client. Idempotent. Requires the project's database to be provisioned.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireOrg();
    const { id } = await params;

    const project = await getProject(orgId, id);
    if (!project) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const dbRec = await getProjectDatabase(id);
    if (!dbRec || dbRec.status !== 'ready') {
      return NextResponse.json({ success: false, error: 'Project has no database' }, { status: 400 });
    }

    const raw = request.nextUrl.searchParams.get('access');
    const access: FileAccess = raw === 'org' || raw === 'private' || raw === 'public' ? raw : 'private';

    await provisionProjectStorage(id, access);
    await injectStorageIntoSandbox(id, (project.framework as Framework) || 'vite', access);

    return NextResponse.json({ success: true, storage: { status: 'ready', access } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
