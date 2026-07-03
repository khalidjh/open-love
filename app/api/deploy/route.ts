import { NextRequest, NextResponse } from 'next/server';
import { getProject, updateProject } from '@/lib/db/repos';
import { getSession } from '@/lib/sandbox/session-store';
import { requireProjectSession, toErrorResponse } from '@/lib/sandbox/require-project-session';
import { detectDeployTarget, collectSandboxSource, type DeployTarget } from '@/lib/deploy/detect';
import { runNetlifyDeploy } from '@/lib/deploy/netlify';
import { runVercelDeploy } from '@/lib/deploy/vercel';
import { runKsaDeploy } from '@/lib/deploy/ksa';

// =============================================================================
// Single deploy entrypoint. The user clicks one "Publish" button; we inspect the
// project's source and route it to the right target automatically:
//   • Next.js / server code → full-stack on the KSA runtime (containers on the
//     KSA VM behind Caddy; set FULLSTACK_TARGET=vercel to fall back to Vercel —
//     that path is a PDPL transfer)
//   • plain Vite SPA        → static on Netlify
// Either way the app talks to the KSA-hosted Supabase, so data stays in KSA.
// =============================================================================

export async function POST(request: NextRequest) {
  let orgId: string;
  let projectId: string;
  let project: NonNullable<Awaited<ReturnType<typeof getProject>>>;
  let provider: NonNullable<ReturnType<typeof getSession>>['provider'];
  try {
    const parsed = await request.json().catch(() => ({}));
    projectId = parsed?.projectId;
    // Deploy is tenant-scoped: authenticate and verify ownership, then use THIS
    // project's sandbox — never a shared global.
    const resolved = await requireProjectSession(projectId);
    orgId = resolved.orgId;
    project = resolved.project;
    provider = resolved.session.provider;
  } catch (error) {
    return toErrorResponse(error);
  }

  try {
    if (!provider) {
      return NextResponse.json(
        { success: false, error: 'No active sandbox. Generate an app first.' },
        { status: 400 }
      );
    }

    // Inspect the source and decide where it goes.
    const source = await collectSandboxSource(provider);
    const target: DeployTarget = detectDeployTarget(source);
    const siteName = project?.name;

    // -------------------------------------------------------------- full-stack
    if (target === 'fullstack') {
      if (!projectId || !orgId) {
        return NextResponse.json(
          { success: false, error: 'A saved project is required to publish a full-stack app.' },
          { status: 400 }
        );
      }

      // Vercel escape hatch (PDPL transfer — interim/testing only).
      if (process.env.FULLSTACK_TARGET === 'vercel') {
        const token = process.env.VERCEL_TOKEN;
        if (!token) {
          return NextResponse.json(
            { success: false, error: 'FULLSTACK_TARGET=vercel but VERCEL_TOKEN is not set.' },
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

      // Default: KSA runtime — SSR/API routes run inside KSA, no PDPL transfer.
      const result = await runKsaDeploy({
        projectId,
        siteName,
        prevUrl: project?.deployUrl,
        files: source,
      });

      try {
        await updateProject(orgId, projectId, {
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

    const siteId = project.netlifySiteId || undefined;
    const result = await runNetlifyDeploy(provider, { token, siteId, siteName });

    try {
      await updateProject(orgId, projectId, {
        netlifySiteId: result.siteId,
        deployUrl: result.url,
        deployTarget: 'static',
      });
    } catch (e) {
      console.error('[deploy] Failed to persist static metadata:', e);
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
