import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, saveVersion, replaceMessages, updateProject } from '@/lib/db/repos';

// POST /api/projects/:id/snapshot
// Persist the current app state: a new code version (files) + chat history,
// plus optional sandbox/deploy metadata. Called after each successful apply.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireOrg();
    const { id } = await params;

    const project = await getProject(orgId, id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const files: Record<string, string> = body.files || {};
    const messages: { role: string; content: string }[] = Array.isArray(body.messages) ? body.messages : [];

    if (Object.keys(files).length > 0) {
      await saveVersion(id, files, body.label);
    }
    await replaceMessages(id, messages);

    // Track the live sandbox / deploy on the project so we can restore later.
    const patch: Record<string, unknown> = {};
    if (body.sandboxId) patch.sandboxId = body.sandboxId;
    if (body.sandboxProvider) patch.sandboxProvider = body.sandboxProvider;
    if (Object.keys(patch).length > 0) {
      await updateProject(orgId, id, patch);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
