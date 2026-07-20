import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { createProject, listProjects } from '@/lib/db/repos';
import { type Framework } from '@/lib/templates';
import { classifyFramework, generateTitle } from '@/lib/ai/classify-framework';

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
    // Classify the framework and generate a concise title from the build request,
    // in parallel (both language-agnostic model calls with keyword/trim fallbacks).
    const source = body.prompt || body.name;
    const [framework, name] = await Promise.all([
      body.framework
        ? Promise.resolve(body.framework as Framework)
        : classifyFramework(source),
      source ? generateTitle(source) : Promise.resolve('Untitled app'),
    ]);
    const project = await createProject(orgId, {
      name: name || 'Untitled app',
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
