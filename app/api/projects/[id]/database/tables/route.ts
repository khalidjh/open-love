import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, getProjectDatabase } from '@/lib/db/repos';
import { createTables, type TableSpec, type TableAccess } from '@/lib/db/provision-tables';

// POST /api/projects/:id/database/tables
// Create tables from a structured spec inside the project's schema.
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

    const body = await request.json().catch(() => ({}));
    const tables: TableSpec[] = Array.isArray(body.tables) ? body.tables : [];
    if (tables.length === 0) {
      return NextResponse.json({ success: true, created: [] });
    }

    // Access defaults come from the caller (the job runner decides based on whether
    // the app has working sign-in). createTables validates and, when auth is
    // unavailable, downgrades owner-scoped tables so nothing silently breaks.
    const { created } = await createTables(id, tables, {
      defaultAccess: body.defaultAccess as TableAccess | undefined,
      allowOwnerScoped: body.allowOwnerScoped !== false,
    });
    return NextResponse.json({ success: true, created });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
