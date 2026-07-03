import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, updateProject } from '@/lib/db/repos';
import { detectDeployTarget, collectSandboxSource, type DeployTarget } from '@/lib/deploy/detect';
import { runNetlifyDeploy } from '@/lib/deploy/netlify';
import { runVercelDeploy } from '@/lib/deploy/vercel';

declare global {
  // Provider wrapper set by create-ai-sandbox-v2
  var activeSandboxProvider: any;
  // In-process fallback for the static site when there's no persisted project.
  var netlifySiteId: string | undefined;
}

// =============================================================================
// Single deploy entrypoint. The user clicks one "Publish" button; we inspect the
// project's source and route it to the right target automatically:
//   • Next.js / server code → full-stack on Vercel
//   • plain Vite SPA        → static on Netlify
// Either way the app talks to the KSA-hosted Supabase, so data stays in KSA.
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const provider = global.activeSandboxProvider;
    if (!provider) {
      return NextResponse.json(
        { success: false, error: 'No active sandbox. Generate an app first.' },
        { status: 400 }
      );
    }

    let projectId: string | undefined;
    try {
      const parsed = await request.json();
      projectId = parsed?.projectId;
    } catch {
      // body is optional
    }

    // Resolve + authorize the project when one is provided (needed to remember the
    // deploy target and, for full-stack, to read the project's creds).
    let orgId: string | undefined;
    let project: Awaited<ReturnType<typeof getProject>> | undefined;
    if (projectId) {
      try {
        ({ orgId } = await requireOrg());
        project = await getProject(orgId, projectId);
        if (!project) {
          return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
        }
      } catch (e) {
        if (e instanceof UnauthorizedError) {
          return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        throw e;
      }
    }

    // Inspect the source and decide where it goes.
    const source = await collectSandboxSource(provider);
    const target: DeployTarget = detectDeployTarget(source);
    const siteName = project?.name;

    // -------------------------------------------------------------- full-stack
    if (target === 'fullstack') {
      const token = process.env.VERCEL_TOKEN;
      if (!token) {
        return NextResponse.json(
          { success: false, error: 'This app needs a server (Vercel), but VERCEL_TOKEN is not set.' },
          { status: 400 }
        );
      }
      if (!projectId || !orgId) {
        return NextResponse.json(
          { success: false, error: 'A saved project is required to publish a full-stack app.' },
          { status: 400 }
        );
      }

      const result = await runVercelDeploy(provider, {
        token,
        projectId,
        vercelProjectId: project?.vercelProjectId,
        siteName,
        files: source,
      });

      try {
        await updateProject(orgId, projectId, {
          vercelProjectId: result.vercelProjectId,
          deployUrl: result.url,
          deployTarget: 'fullstack',
        });
      } catch (e) {
        console.error('[deploy] Failed to persist full-stack metadata:', e);
      }

      return NextResponse.json({
        success: true,
        target,
        url: result.url,
        state: result.state,
        message: 'Published your app',
      });
    }

    // ------------------------------------------------------------------ static
    const token = process.env.NETLIFY_API_KEY;
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'NETLIFY_API_KEY is not set. Add it to .env.local and restart the dev server.' },
        { status: 400 }
      );
    }

    const siteId = project?.netlifySiteId || global.netlifySiteId;
    const result = await runNetlifyDeploy(provider, { token, siteId: siteId || undefined, siteName });

    if (project && orgId && projectId) {
      try {
        await updateProject(orgId, projectId, {
          netlifySiteId: result.siteId,
          deployUrl: result.url,
          deployTarget: 'static',
        });
      } catch (e) {
        console.error('[deploy] Failed to persist static metadata:', e);
      }
    } else {
      global.netlifySiteId = result.siteId;
    }

    return NextResponse.json({
      success: true,
      target,
      url: result.url,
      state: result.state,
      message: result.state === 'ready' ? 'Published your app' : 'Published (still processing)',
    });
  } catch (error) {
    console.error('[deploy] Error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
