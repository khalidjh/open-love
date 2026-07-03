import { NextRequest, NextResponse } from 'next/server';
import { ensureActiveSandbox } from '@/lib/sandbox/ensure-active-sandbox';
import { makeProjectFallback } from '@/lib/sandbox/db-fallback';

// POST /api/ensure-sandbox   body: { projectId?: string }
// Guarantees a live sandbox for the current session, transparently rebuilding
// and replaying the generated files if the previous one was reaped (E2B TTL).
// When a projectId is supplied, falls back to the project's latest DB snapshot
// if the in-memory file cache was lost (e.g. the server restarted), so recovery
// restores the real app rather than a blank scaffold.
// Returns the (possibly new) sandbox URL so the client can reload the preview.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;

    const result = await ensureActiveSandbox({
      loadFallback: makeProjectFallback(projectId),
    });

    return NextResponse.json({
      success: true,
      sandboxData: result.sandboxData,
      recreated: result.recreated,
    });
  } catch (error) {
    console.error('[ensure-sandbox] Error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
