import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, getLatestVersion, getMessages, updateProject, deleteProject, getProjectDatabase } from '@/lib/db/repos';
import { runKsaTeardown } from '@/lib/deploy/teardown';
import { deprovisionProjectSchema } from '@/lib/db/provision-schema';
import { deprovisionProjectAuth } from '@/lib/auth/provision-auth';
import { generateTitle } from '@/lib/ai/classify-framework';

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
      // When the newest snapshot postdates deployedAt, the client offers
      // "Redeploy"; otherwise the publish button rests disabled.
      latestVersionAt: version?.createdAt ?? null,
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
    // A client rename often passes the raw/truncated first prompt as the name;
    // turn it into a proper short title (generateTitle keeps already-short names).
    if (typeof body.name === 'string' && body.name.trim()) {
      body.name = await generateTitle(body.name);
    }
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

// DELETE /api/projects/:id — permanently delete a project. Takes any live
// deployment offline first (so we never orphan a running container / Caddy route),
// then hard-deletes the row (FK cascades remove versions, chat, tenant_* rows and
// visit analytics).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireOrg();
    const { id } = await params;
    const project = await getProject(orgId, id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    // Tear down the live deployment before dropping the row — otherwise the
    // container/route would keep serving with no project record behind it.
    if (project.deployUrl) await runKsaTeardown(project);

    // Deprovision external tenant resources while the tenant_* rows still exist
    // (the FK cascade in deleteProject would otherwise remove the refs we need).
    // Best-effort: a flaky external API must not make a project undeletable — we
    // log and continue, worst case leaving an orphan to sweep later.
    if (await getProjectDatabase(id)) {
      await deprovisionProjectSchema(id).catch((e) =>
        console.error(`[delete-project] schema deprovision failed for ${id}:`, e));
    }
    await deprovisionProjectAuth(id).catch((e) =>
      console.error(`[delete-project] auth deprovision failed for ${id}:`, e));
    // The per-project AI token is authenticated by a DB lookup on its hash, so the
    // FK cascade below (removing tenant_ai) revokes it — no external call needed.

    await deleteProject(orgId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[delete-project] Error:', error);
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
