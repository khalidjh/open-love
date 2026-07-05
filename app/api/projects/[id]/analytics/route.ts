import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, getAppAnalytics } from '@/lib/db/repos';

// GET — deployed-app visitor analytics for a project (owner-scoped).
// Shape consumed by the Analytics panel in app/generation/page.tsx:
//   { success, published, url, totals, daily, topPaths }
// `published` gates the "publish first" empty state; analytics are only queried
// once the project has a deployUrl.
const EMPTY = { totals: { views: 0, visitors: 0 }, daily: [] as unknown[], topPaths: [] as unknown[] };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { orgId } = await requireOrg();
    const project = await getProject(orgId, id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const published = !!project.deployUrl;
    const analytics = published ? await getAppAnalytics(id) : EMPTY;

    return NextResponse.json({
      success: true,
      published,
      url: project.deployUrl ?? null,
      ...analytics,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    // Frontend-friendly: still return an empty, unpublished payload on internal error.
    return NextResponse.json({ success: false, published: false, url: null, ...EMPTY });
  }
}
