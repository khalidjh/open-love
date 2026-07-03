import { NextRequest, NextResponse } from 'next/server';
import { requireProjectSession, toErrorResponse } from '@/lib/sandbox/require-project-session';

// GET /api/sandbox-status?projectId=...
// Reports whether the caller's project has a live sandbox. Runs on page mount, so
// a missing projectId (brand-new session, nothing created yet) is not an error —
// it just means "no sandbox".
export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId') || undefined;

  // No project yet → nothing to report. Don't 400 the mount-time poll.
  if (!projectId) {
    return NextResponse.json({
      success: true,
      active: false,
      healthy: false,
      sandboxData: null,
      message: 'No active sandbox',
    });
  }

  try {
    const { session } = await requireProjectSession(projectId);
    const provider = session.provider;
    const sandboxExists = !!provider;

    let sandboxHealthy = false;
    let sandboxInfo = null;

    if (sandboxExists && provider) {
      try {
        // Real liveness probe — getSandboxInfo() only returns cached in-memory
        // data and reports "healthy" even after the underlying VM was reaped,
        // which is exactly how the raw "Sandbox Not Found" page leaks through.
        const providerInfo = provider.getSandboxInfo();
        sandboxHealthy = typeof provider.ping === 'function'
          ? await provider.ping()
          : !!providerInfo;

        // Refresh the TTL on every healthy poll so a sandbox the user is actively
        // viewing never gets reaped out from under them.
        if (sandboxHealthy && typeof provider.keepAlive === 'function') {
          await provider.keepAlive().catch(() => {});
        }

        sandboxInfo = {
          sandboxId: providerInfo?.sandboxId || session.sandboxData?.sandboxId,
          url: providerInfo?.url || session.sandboxData?.url,
          filesTracked: Array.from(session.existingFiles),
          lastHealthCheck: new Date().toISOString(),
        };
      } catch (error) {
        console.error('[sandbox-status] Health check failed:', error);
        sandboxHealthy = false;
      }
    }

    return NextResponse.json({
      success: true,
      active: sandboxExists,
      healthy: sandboxHealthy,
      sandboxData: sandboxInfo,
      message: sandboxHealthy
        ? 'Sandbox is active and healthy'
        : sandboxExists
          ? 'Sandbox exists but is not responding'
          : 'No active sandbox',
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
