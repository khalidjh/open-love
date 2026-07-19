import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, getProjectDatabase } from '@/lib/db/repos';
import { provisionProjectRoles } from '@/lib/db/provision-roles';
import { injectRolesIntoSandbox } from '@/lib/sandbox/inject-roles';
import { type Framework } from '@/lib/templates';

// POST /api/projects/:id/database/roles
// Provision the role-based access infra (app_members table + helper functions) and
// inject the etlaqTeam client into the sandbox. Idempotent. Requires the project's
// database to be provisioned (roles live in its schema).
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireOrg();
    const { id } = await params;

    const project = await getProject(orgId, id);
    if (!project) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const dbRec = await getProjectDatabase(id);
    if (!dbRec || dbRec.status !== 'ready') {
      return NextResponse.json({ success: false, error: 'Project has no database' }, { status: 400 });
    }

    await provisionProjectRoles(id);
    await injectRolesIntoSandbox(id, (project.framework as Framework) || 'vite');

    return NextResponse.json({ success: true, roles: { status: 'ready' } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
