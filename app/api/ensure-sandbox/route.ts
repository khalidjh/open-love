import { NextRequest, NextResponse } from 'next/server';
import { ensureActiveSandbox } from '@/lib/sandbox/ensure-active-sandbox';
import { makeProjectFallback } from '@/lib/sandbox/db-fallback';
import { requireProjectSession, toErrorResponse } from '@/lib/sandbox/require-project-session';

// POST /api/ensure-sandbox   body: { projectId: string }
// Guarantees a live sandbox for the caller's project, transparently rebuilding
// and replaying the generated files if the previous one was reaped (E2B TTL).
// Falls back to the project's latest DB snapshot if the in-memory session was
// lost (e.g. the server restarted). Returns the (possibly new) sandbox URL.
//
// Tenant-isolated: requireProjectSession authenticates the caller and verifies
// their org owns the project before any sandbox work happens.
export async function POST(request: NextRequest) {
  let projectId: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    projectId = body?.projectId;

    const { orgId, session } = await requireProjectSession(projectId);

    const result = await ensureActiveSandbox({
      session,
      orgId,
      projectId: projectId!,
      loadFallback: makeProjectFallback(projectId),
    });

    return NextResponse.json({
      success: true,
      sandboxData: result.sandboxData,
      recreated: result.recreated,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
