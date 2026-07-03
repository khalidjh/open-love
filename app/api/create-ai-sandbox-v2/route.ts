import { NextRequest, NextResponse } from 'next/server';
import { SandboxFactory } from '@/lib/sandbox/factory';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { updateProject } from '@/lib/db/repos';
import { type Framework } from '@/lib/templates';
import { requireProjectSession, toErrorResponse } from '@/lib/sandbox/require-project-session';

// POST /api/create-ai-sandbox-v2   body: { projectId: string, framework?: 'vite'|'nextjs' }
// Creates a fresh sandbox for ONE project. Tenant-isolated: only tears down and
// replaces that project's own sandbox — never other tenants'.
export async function POST(request: NextRequest) {
  let projectId: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    projectId = body?.projectId;
    const framework: Framework = body?.framework === 'nextjs' ? 'nextjs' : 'vite';

    const { orgId, session } = await requireProjectSession(projectId);
    console.log('[create-ai-sandbox-v2] Creating sandbox...', { projectId, framework });

    // Tear down only THIS project's previous sandbox (if any). Do NOT call
    // sandboxManager.terminateAll() — that would kill every tenant's sandbox.
    if (session.provider) {
      try {
        await session.provider.terminate();
      } catch (e) {
        console.error('[create-ai-sandbox-v2] failed to terminate prior sandbox:', e);
      }
      session.provider = null;
    }
    session.existingFiles = new Set<string>();

    // Create new sandbox using factory
    const provider = SandboxFactory.create();
    const sandboxInfo = await provider.createSandbox();

    if (framework === 'nextjs') {
      console.log('[create-ai-sandbox-v2] Setting up Next.js app...');
      await provider.setupNextApp();
    } else {
      console.log('[create-ai-sandbox-v2] Setting up Vite React app...');
      await provider.setupViteApp();
    }

    // Register with sandbox manager (bookkeeping) and wire the project's session.
    sandboxManager.registerSandbox(sandboxInfo.sandboxId, provider);
    session.provider = provider;
    session.framework = framework;
    session.sandboxData = { sandboxId: sandboxInfo.sandboxId, url: sandboxInfo.url };
    session.fileCache = {
      files: {},
      lastSync: Date.now(),
      sandboxId: sandboxInfo.sandboxId,
    };

    // Persist the binding so recovery / a returning session can find it.
    try {
      await updateProject(orgId, projectId!, {
        sandboxId: sandboxInfo.sandboxId,
        sandboxProvider: (process.env.SANDBOX_PROVIDER || 'e2b') as string,
        framework,
      });
    } catch (e) {
      console.error('[create-ai-sandbox-v2] failed to persist sandbox binding', e);
    }

    console.log('[create-ai-sandbox-v2] Sandbox ready at:', sandboxInfo.url);

    return NextResponse.json({
      success: true,
      sandboxId: sandboxInfo.sandboxId,
      url: sandboxInfo.url,
      provider: sandboxInfo.provider,
      message: 'Sandbox created and app initialized',
    });
  } catch (error) {
    // requireProjectSession failures (401/400/404) map cleanly here; anything
    // else is a genuine 500 from sandbox creation.
    if (
      (error as Error)?.name === 'UnauthorizedError' ||
      (error as Error)?.name === 'BadRequestError' ||
      (error as Error)?.name === 'ProjectNotFoundError'
    ) {
      return toErrorResponse(error);
    }
    console.error('[create-ai-sandbox-v2] Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create sandbox',
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
