import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { createProject, listProjects } from '@/lib/db/repos';
import { type Framework } from '@/lib/templates';
import { classifyFramework } from '@/lib/ai/classify-framework';

// GET /api/projects — list the current tenant's projects
export async function GET() {
  try {
    const { orgId } = await requireOrg();
    const projects = await listProjects(orgId);
    return NextResponse.json({ success: true, projects });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

// POST /api/projects — create a project
export async function POST(request: NextRequest) {
  try {
    const { orgId } = await requireOrg();
    const body = await request.json().catch(() => ({}));
    // Classify the framework from the build request by intent (a backend need →
    // Next.js), language-agnostic, unless the caller pins it explicitly.
    const framework: Framework = body.framework || (await classifyFramework(body.prompt || body.name));
    const project = await createProject(orgId, {
      name: body.name || 'Untitled app',
      sourceUrl: body.sourceUrl,
      model: body.model,
      framework,
    });
    return NextResponse.json({ success: true, project });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
