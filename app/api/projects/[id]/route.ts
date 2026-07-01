import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, getLatestVersion, getMessages, updateProject } from '@/lib/db/repos';

// GET /api/projects/:id — load a project with its latest code snapshot + chat
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireOrg();
    const { id } = await params;
    const project = await getProject(orgId, id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    const [version, msgs] = await Promise.all([
      getLatestVersion(id),
      getMessages(id),
    ]);
    return NextResponse.json({
      success: true,
      project,
      files: version?.files ?? {},
      messages: msgs,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

// PATCH /api/projects/:id — update mutable fields (sandbox id, deploy info, name…)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireOrg();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const updated = await updateProject(orgId, id, body);
    if (!updated) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, project: updated });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
