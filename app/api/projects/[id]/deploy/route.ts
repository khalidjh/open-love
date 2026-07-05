import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, updateProject } from '@/lib/db/repos';
import { runKsaTeardown } from '@/lib/deploy/teardown';

// DELETE /api/projects/:id/deploy — unpublish: take the live app offline (stop
// its container, drop its Caddy route, remove its files) but KEEP the project so
// it can be re-published later. Clears deployUrl so the dashboard stops showing
// it as "live".
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireOrg();
    const { id } = await params;
    const project = await getProject(orgId, id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    if (!project.deployUrl) {
      // Already offline — idempotent success.
      return NextResponse.json({ success: true, message: 'Not published' });
    }

    await runKsaTeardown(project);
    await updateProject(orgId, id, { deployUrl: null });

    return NextResponse.json({ success: true, message: 'Unpublished' });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[unpublish] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
