// =============================================================================
// Server-side background build runner.
//
// Historically the BROWSER orchestrated a build: it consumed the generation
// SSE stream, then called apply-ai-code-stream, then persisted the snapshot —
// so closing the tab mid-build killed everything after the current step. This
// runner moves that orchestration server-side: it drives the exact same
// pipeline (generate → provision db/ai/auth → apply → snapshot) through the
// same internal HTTP endpoints with the caller's auth cookie forwarded (the
// established pattern — see apply-ai-code-stream's install-packages call), and
// publishes every progress event to the in-memory job bus. The page just
// subscribes; if it disconnects, the build finishes anyway and the snapshot +
// chat land in the DB for the next reload.
// =============================================================================

import {
  createGenerationJob,
  updateGenerationJob,
  touchGenerationJob,
  appendMessages,
  saveVersion,
  updateProject,
} from '@/lib/db/repos';
import { getSession } from '@/lib/sandbox/session-store';
import { isZitadelConfigured } from '@/lib/auth/zitadel';
import { openJobChannel, publishJobEvent, finishJobChannel } from './job-events';

export interface StartJobOptions {
  orgId: string;
  projectId: string;
  prompt: string;
  model?: string;
  isEdit: boolean;
  // Client-shaped generation context (recentMessages, conversationContext, …),
  // passed through verbatim to generate-ai-code-stream.
  context?: unknown;
  images?: string[];
  // Base URL for internal self-calls (protocol + host of the incoming request).
  origin: string;
  // The caller's auth cookie — internal calls authenticate as the user.
  cookie: string;
}

// Hard ceiling on a single build; a hung upstream stream must not leak a
// runner (and its heartbeat) forever.
const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 20 * 1000;

// --- Detection of what a generated app needs (mirrors the old client logic) ---
const needsDatabase = (generated: string): boolean =>
  /<tables>[\s\S]*?<\/tables>/i.test(generated) ||
  /supabaseClient|@supabase\/supabase-js|(VITE_|NEXT_PUBLIC_)SUPABASE_/.test(generated);
const needsAi = (generated: string): boolean =>
  /ETLAQ_AI_(URL|KEY)|ETLAQ_TRANSCRIBE_URL/.test(generated);
const needsAuth = (generated: string): boolean =>
  /etlaqAuth|(VITE_|NEXT_PUBLIC_)AUTH_(ISSUER|CLIENT_ID)/.test(generated);

// Create the durable job row + live channel and kick off the pipeline without
// awaiting it. Returns the job id immediately.
export async function startGenerationJob(opts: StartJobOptions): Promise<string> {
  const job = await createGenerationJob(opts.projectId, {
    prompt: opts.prompt,
    isEdit: opts.isEdit,
    model: opts.model ?? null,
  });
  openJobChannel(job.id);

  // Detached: the whole point is that this outlives the HTTP request (and the
  // browser tab). Errors are caught inside run(); this catch is a backstop.
  void run(job.id, opts).catch(async (error) => {
    console.error('[job-runner] unhandled pipeline error:', error);
    await failJob(job.id, (error as Error).message || 'Build failed unexpectedly');
  });

  return job.id;
}

async function failJob(jobId: string, error: string): Promise<void> {
  try {
    await updateGenerationJob(jobId, { status: 'failed', error, finishedAt: new Date() });
  } catch (e) {
    console.error('[job-runner] failed to persist job failure:', e);
  }
  publishJobEvent(jobId, { stage: 'job', type: 'failed', error });
  finishJobChannel(jobId);
}

async function run(jobId: string, opts: StartJobOptions): Promise<void> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(new Error('Build timed out')), JOB_TIMEOUT_MS);
  const heartbeat = setInterval(() => {
    touchGenerationJob(jobId).catch(() => {});
  }, HEARTBEAT_MS);

  const internalFetch = (path: string, init?: RequestInit) =>
    fetch(`${opts.origin}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        cookie: opts.cookie,
        ...(init?.headers || {}),
      },
      signal: abort.signal,
    });

  const setPhase = async (phase: string) => {
    await updateGenerationJob(jobId, { phase });
    publishJobEvent(jobId, { stage: 'job', type: 'phase', phase });
  };

  try {
    // ---- Phase 1: generation ------------------------------------------------
    await setPhase('generating');
    const genRes = await internalFetch('/api/generate-ai-code-stream', {
      method: 'POST',
      body: JSON.stringify({
        prompt: opts.prompt,
        model: opts.model,
        context: opts.context,
        isEdit: opts.isEdit,
        projectId: opts.projectId,
        images: opts.images && opts.images.length ? opts.images : undefined,
      }),
    });
    if (!genRes.ok || !genRes.body) {
      throw new Error(`Generation request failed (HTTP ${genRes.status})`);
    }

    let generatedCode = '';
    let explanation = '';
    let packagesToInstall: string[] = [];
    let genError: string | null = null;
    await readSse(genRes, (data) => {
      if (data.type === 'complete') {
        generatedCode = typeof data.generatedCode === 'string' ? data.generatedCode : '';
        explanation = typeof data.explanation === 'string' ? data.explanation : '';
        if (Array.isArray(data.packagesToInstall)) packagesToInstall = data.packagesToInstall;
      } else if (data.type === 'error') {
        genError = typeof data.error === 'string' ? data.error : 'Generation failed';
      }
      publishJobEvent(jobId, { ...data, stage: 'generate' });
    });
    if (genError) throw new Error(genError);

    // A purely conversational response (no code) still ends the job cleanly.
    if (!generatedCode) {
      await updateGenerationJob(jobId, {
        status: 'completed',
        phase: 'done',
        explanation: explanation || null,
        filesChanged: [],
        finishedAt: new Date(),
      });
      publishJobEvent(jobId, { stage: 'job', type: 'done', explanation, filesChanged: [] });
      finishJobChannel(jobId);
      return;
    }

    // ---- Phase 2: provisioning (storage / AI / auth), before apply ----------
    await setPhase('provisioning');

    if (needsDatabase(generatedCode)) {
      await provision(jobId, internalFetch, 'database',
        'Setting up storage so your app can save data…',
        `/api/projects/${opts.projectId}/database`);
      await createDeclaredTables(jobId, internalFetch, opts.projectId, generatedCode);
    }
    if (needsAi(generatedCode)) {
      await provision(jobId, internalFetch, 'ai',
        'Enabling AI for your app…',
        `/api/projects/${opts.projectId}/ai`);
    }
    if (needsAuth(generatedCode)) {
      await provision(jobId, internalFetch, 'auth',
        'Setting up private sign-in for your app…',
        `/api/projects/${opts.projectId}/auth`);
    }

    // ---- Phase 3: apply to the sandbox --------------------------------------
    // apply-ai-code-stream guarantees a live sandbox itself (ensureActiveSandbox
    // with DB-snapshot fallback), so this works even when no browser ever
    // created one for this build.
    await setPhase('applying');
    const applyRes = await internalFetch('/api/apply-ai-code-stream', {
      method: 'POST',
      body: JSON.stringify({
        response: generatedCode,
        isEdit: opts.isEdit,
        packages: packagesToInstall,
        projectId: opts.projectId,
      }),
    });
    if (!applyRes.ok || !applyRes.body) {
      throw new Error(`Apply request failed (HTTP ${applyRes.status})`);
    }

    let applyResults: Record<string, unknown> | null = null;
    let applyError: string | null = null;
    await readSse(applyRes, (data) => {
      if (data.type === 'complete') {
        applyResults = (data.results as Record<string, unknown>) ?? null;
      } else if (data.type === 'error') {
        applyError = typeof data.error === 'string' ? data.error : 'Apply failed';
      }
      publishJobEvent(jobId, { ...data, stage: 'apply' });
    });
    if (applyError) throw new Error(applyError);

    const filesChanged: string[] = [
      ...(((applyResults as any)?.filesCreated as string[]) || []),
      ...(((applyResults as any)?.filesUpdated as string[]) || []),
    ];

    // ---- Phase 4: persist the snapshot + chat -------------------------------
    await setPhase('finalizing');
    try {
      const filesRes = await internalFetch(
        `/api/get-sandbox-files?projectId=${encodeURIComponent(opts.projectId)}`,
        { method: 'GET' },
      );
      const filesData = await filesRes.json().catch(() => null);
      const files: Record<string, string> = filesData?.success ? (filesData.files || {}) : {};
      if (Object.keys(files).length > 0) {
        await saveVersion(opts.projectId, files);
      }

      // Track the live sandbox on the project row (enables restore on reload).
      const session = getSession(opts.projectId);
      if (session?.sandboxData?.sandboxId) {
        await updateProject(opts.orgId, opts.projectId, {
          sandboxId: session.sandboxData.sandboxId,
          sandboxProvider: session.provider?.getSandboxInfo()?.provider,
        });
      }

      // Append this turn's chat so a user who closed the tab still finds the
      // conversation on reload. If the tab stayed open, the client replaces the
      // whole history with its own list right after — same end state.
      const doneMessage = opts.isEdit
        ? 'Your changes are live — open the Preview tab to see them.'
        : 'Your app is ready! Open the Preview tab to try it.';
      await appendMessages(opts.projectId, [
        { role: 'user', content: opts.prompt },
        ...(filesChanged.length > 0 ? [{ role: 'build', content: JSON.stringify(filesChanged) }] : []),
        { role: 'ai', content: explanation || 'Code generated!' },
        { role: 'system', content: doneMessage },
      ]);
    } catch (persistError) {
      // A failed snapshot must not fail an otherwise successful build — the
      // sandbox has the code; the client can persist on its next apply.
      console.error('[job-runner] snapshot persistence failed:', persistError);
      publishJobEvent(jobId, {
        stage: 'job',
        type: 'warning',
        message: 'Build finished, but saving the project snapshot failed.',
      });
    }

    // ---- Done ----------------------------------------------------------------
    await updateGenerationJob(jobId, {
      status: 'completed',
      phase: 'done',
      explanation: explanation || null,
      filesChanged,
      finishedAt: new Date(),
    });
    publishJobEvent(jobId, {
      stage: 'job',
      type: 'done',
      explanation,
      filesChanged,
      results: applyResults ?? undefined,
    });
    finishJobChannel(jobId);
  } catch (error) {
    await failJob(jobId, (error as Error).message || 'Build failed');
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
  }
}

// Provision one capability via its project endpoint, bracketing it with events
// the client renders as the familiar transient status bubble. Failures degrade
// gracefully (like the old client helpers): the build continues without it.
async function provision(
  jobId: string,
  internalFetch: (path: string, init?: RequestInit) => Promise<Response>,
  key: 'database' | 'ai' | 'auth',
  message: string,
  path: string,
): Promise<void> {
  publishJobEvent(jobId, { stage: 'job', type: 'provisioning-start', key, message });
  let ok = false;
  try {
    const res = await internalFetch(path, { method: 'POST' });
    const data = await res.json().catch(() => null);
    ok = Boolean(
      data?.success &&
      (data.database?.status === 'ready' || data.ai?.status === 'ready' || data.auth?.status === 'ready'),
    );
  } catch (e) {
    console.error(`[job-runner] ${key} provisioning failed:`, e);
  }
  publishJobEvent(jobId, { stage: 'job', type: 'provisioning-end', key, ok });
}

// Create any tables the AI declared in a <tables> block (mirrors the old
// client-side createTablesFromResponse).
async function createDeclaredTables(
  jobId: string,
  internalFetch: (path: string, init?: RequestInit) => Promise<Response>,
  projectId: string,
  generatedCode: string,
): Promise<void> {
  const match = generatedCode.match(/<tables>([\s\S]*?)<\/tables>/i);
  if (!match) return;
  let tables: unknown;
  try {
    tables = JSON.parse(match[1].trim());
  } catch {
    console.error('[job-runner] could not parse <tables> block');
    return;
  }
  if (!Array.isArray(tables) || tables.length === 0) return;
  // Owner-scoped tables (private / public_read) only work when the app has a real
  // sign-in: they filter rows by the logged-in user's id. If this app uses auth
  // AND a Zitadel backend is configured, default undeclared tables to `private`
  // (secure by default) and honor owner-scoped requests; otherwise fall back to
  // `public` and downgrade owner-scoped tables so the app still works.
  const authAvailable = needsAuth(generatedCode) && isZitadelConfigured();
  try {
    const res = await internalFetch(`/api/projects/${projectId}/database/tables`, {
      method: 'POST',
      body: JSON.stringify({
        tables,
        defaultAccess: authAvailable ? 'private' : 'public',
        allowOwnerScoped: authAvailable,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!data?.success) {
      console.error('[job-runner] table creation failed:', data?.error);
      publishJobEvent(jobId, { stage: 'job', type: 'warning', message: 'Some data tables could not be created.' });
    }
  } catch (e) {
    console.error('[job-runner] table creation error:', e);
  }
}

// Consume an SSE response body, invoking onEvent for each `data:` JSON payload.
async function readSse(
  res: Response,
  onEvent: (data: Record<string, unknown> & { type: string }) => void,
): Promise<void> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data && typeof data.type === 'string') onEvent(data);
      } catch {
        // Ignore malformed frames (keep-alive comments, partial writes).
      }
    }
  }
}
