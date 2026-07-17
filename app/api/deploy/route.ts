import { NextRequest, NextResponse } from 'next/server';
import { getProject, updateProject, getLatestVersion } from '@/lib/db/repos';
import { getSession } from '@/lib/sandbox/session-store';
import { requireProjectSession, toErrorResponse } from '@/lib/sandbox/require-project-session';
import { ensureActiveSandbox } from '@/lib/sandbox/ensure-active-sandbox';
import { makeProjectFallback } from '@/lib/sandbox/db-fallback';
import { detectDeployTarget, collectSandboxSource, type DeployTarget } from '@/lib/deploy/detect';
import { runNetlifyDeploy } from '@/lib/deploy/netlify';
import { runVercelDeploy } from '@/lib/deploy/vercel';
import { runKsaDeploy } from '@/lib/deploy/ksa';
import { runKsaStaticDeploy } from '@/lib/deploy/ksa-static';

// =============================================================================
// Single deploy entrypoint. The user clicks one "Publish" button; we inspect the
// project's source and route it to the right target automatically:
//   • Next.js / server code → full-stack on the KSA runtime (containers on the
//     KSA VM behind Caddy; set FULLSTACK_TARGET=vercel to fall back to Vercel —
//     that path is a PDPL transfer)
//   • plain Vite SPA        → static on the KSA runtime (Caddy file_server on the
//     KSA VM; set STATIC_TARGET=netlify to fall back to Netlify)
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

    // Publish must work even when the sandbox died (E2B TTL) or the server
    // restarted since the last build: reconnect to a surviving sandbox, or
    // rebuild it from the project's DB snapshot, before reading the source.
    // Without this, "Publish" fails with "No active sandbox" for any user who
    // comes back to a finished app later — the most natural time to publish.
    const loadFallback = makeProjectFallback(projectId);
    if (!resolved.session.provider) {
      // No live sandbox this process has ever seen: only recover if there is a
      // saved snapshot — otherwise we'd scaffold and publish an empty app.
      const snapshot = loadFallback ? await loadFallback() : null;
      if (!snapshot) {
        return NextResponse.json(
          { success: false, error: 'Nothing to publish yet — generate an app first.' },
          { status: 400 }
        );
      }
    }
    const ensured = await ensureActiveSandbox({
      session: resolved.session,
      orgId,
      projectId,
      loadFallback,
      lastSandboxId: project.sandboxId,
    });
    provider = ensured.provider;
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

    // Completeness backstop: anything in the durable snapshot that's missing
    // from the live sandbox ships too (live wins per file). A partially
    // recovered sandbox must not publish a build that can't compile.
    try {
      const version = await getLatestVersion(projectId);
      const snapshot = (version?.files ?? {}) as Record<string, string>;
      for (const [p, c] of Object.entries(snapshot)) {
        if (!(p in source)) source[p] = c;
      }
    } catch (e) {
      console.error('[deploy] snapshot backstop failed (continuing with live files):', e);
    }

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
            deployedAt: new Date(),
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
          deployedAt: new Date(),
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
    // Netlify escape hatch (opt-in; we default to serving static in-KSA to avoid
    // the free-tier limit and keep hosting inside KSA).
    if (process.env.STATIC_TARGET === 'netlify') {
      const token = process.env.NETLIFY_API_KEY;
      if (!token) {
        return NextResponse.json(
          { success: false, error: 'STATIC_TARGET=netlify but NETLIFY_API_KEY is not set.' },
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
          deployedAt: new Date(),
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
    }

    // Default: serve the built SPA from the KSA runtime via Caddy.
    if (!projectId || !orgId) {
      return NextResponse.json(
        { success: false, error: 'A saved project is required to publish a static app.' },
        { status: 400 }
      );
    }

    const result = await runKsaStaticDeploy(provider, {
      projectId,
      siteName,
      prevUrl: project?.deployUrl,
    });

    try {
      await updateProject(orgId, projectId, {
        deployUrl: result.url,
        deployTarget: 'static',
        deployedAt: new Date(),
      });
    } catch (e) {
      console.error('[deploy] Failed to persist static metadata:', e);
    }

    return NextResponse.json({
      success: true,
      target,
      url: result.url,
      state: result.state,
      message: 'Published your app',
    });
  } catch (error) {
    console.error('[deploy] Error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
