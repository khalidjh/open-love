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
import { detectBuildErrors, type BuildError } from './build-check';
import { translate, type Lang } from '@/lib/i18n/dictionary';
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
  // UI language, so status messages shown in chat match the interface.
  lang?: Lang;
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
// Role-based access: the app uses the team client or declares an `org` table.
const needsRoles = (generated: string): boolean =>
  /etlaqTeam|app_members|app_claim_membership|["']access["']\s*:\s*["']org["']/.test(generated);
// File uploads: the app uses the files client or Supabase storage directly.
const needsStorage = (generated: string): boolean =>
  /etlaqFiles|storage\.from\(|\.createSignedUrl\(/.test(generated);

// Turn detected build errors into a tight, surgical fix instruction for the model.
function buildHealPrompt(errors: BuildError[]): string {
  const details = errors
    .slice(0, 4)
    .map((e) => (e.file ? `File ${e.file}:\n${e.message}` : e.message))
    .join('\n\n');
  return (
    `The app you just generated has a build error and will not run. Fix ONLY what is ` +
    `needed to resolve it — do not redesign or change unrelated code, and return the ` +
    `corrected file(s) in full.\n\nBuild error:\n${details}`
  );
}

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
  // Localize status messages to the UI language.
  const jt = (key: string) => translate(opts.lang ?? 'en', key);
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

  // Generation and apply are each an SSE stream we consume identically whether it's
  // the first pass or a self-heal retry — factor them so the heal loop reuses them.
  const generateCode = async (
    prompt: string,
    isEdit: boolean,
    context: unknown,
    images?: string[],
  ) => {
    const genRes = await internalFetch('/api/generate-ai-code-stream', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        model: opts.model,
        context,
        isEdit,
        projectId: opts.projectId,
        images: images && images.length ? images : undefined,
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
    return { generatedCode, explanation, packagesToInstall, genError };
  };

  const applyCode = async (code: string, packages: string[], isEdit: boolean) => {
    const applyRes = await internalFetch('/api/apply-ai-code-stream', {
      method: 'POST',
      body: JSON.stringify({ response: code, isEdit, packages, projectId: opts.projectId }),
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
    return { applyResults, applyError };
  };

  const collectChangedFiles = (results: Record<string, unknown> | null): string[] => [
    ...(((results as any)?.filesCreated as string[]) || []),
    ...(((results as any)?.filesUpdated as string[]) || []),
  ];

  try {
    // ---- Phase 1: generation ------------------------------------------------
    await setPhase('generating');
    const gen = await generateCode(opts.prompt, opts.isEdit, opts.context, opts.images);
    if (gen.genError) throw new Error(gen.genError);
    const generatedCode = gen.generatedCode;
    let explanation = gen.explanation;
    const packagesToInstall = gen.packagesToInstall;

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
        jt('job.storage'),
        `/api/projects/${opts.projectId}/database`);
      await createDeclaredTables(jobId, internalFetch, opts.projectId, generatedCode, opts.lang ?? 'en');
    }
    if (needsAi(generatedCode)) {
      await provision(jobId, internalFetch, 'ai',
        jt('job.ai'),
        `/api/projects/${opts.projectId}/ai`);
    }
    if (needsAuth(generatedCode)) {
      await provision(jobId, internalFetch, 'auth',
        jt('job.auth'),
        `/api/projects/${opts.projectId}/auth`);
    }
    if (needsRoles(generatedCode)) {
      await provision(jobId, internalFetch, 'roles',
        jt('job.roles'),
        `/api/projects/${opts.projectId}/database/roles`);
    }
    if (needsStorage(generatedCode)) {
      // Files inherit the app's access model: role-based → org, signed-in → private,
      // otherwise public.
      const fileAccess = needsRoles(generatedCode) ? 'org' : needsAuth(generatedCode) ? 'private' : 'public';
      await provision(jobId, internalFetch, 'storage',
        jt('job.files'),
        `/api/projects/${opts.projectId}/database/storage?access=${fileAccess}`);
    }

    // ---- Phase 3: apply to the sandbox --------------------------------------
    // apply-ai-code-stream guarantees a live sandbox itself (ensureActiveSandbox
    // with DB-snapshot fallback), so this works even when no browser ever
    // created one for this build.
    await setPhase('applying');
    const apply = await applyCode(generatedCode, packagesToInstall, opts.isEdit);
    if (apply.applyError) throw new Error(apply.applyError);
    let applyResults = apply.applyResults;
    const filesChanged: string[] = collectChangedFiles(applyResults);

    // ---- Phase 3.5: verify the build compiles; auto-fix if it doesn't -------
    // Detect compile/syntax errors the model may have introduced, and re-prompt it
    // to fix them (up to MAX_HEAL times). Fully guarded and best-effort: a failure
    // in detection or healing must never fail an otherwise-successful build.
    try {
      const session = getSession(opts.projectId);
      const provider = session?.provider;
      const framework = session?.framework ?? 'vite';
      const MAX_HEAL = 2;
      for (let attempt = 1; provider && attempt <= MAX_HEAL; attempt++) {
        const errors = await detectBuildErrors(provider, framework, filesChanged);
        if (errors.length === 0) break;
        await setPhase('fixing');
        publishJobEvent(jobId, {
          stage: 'job',
          type: 'healing',
          attempt,
          message: jt('job.fixing'),
        });
        const heal = await generateCode(buildHealPrompt(errors), true, undefined);
        if (heal.genError || !heal.generatedCode) break;
        const healApply = await applyCode(heal.generatedCode, heal.packagesToInstall, true);
        if (healApply.applyError) break;
        if (heal.explanation) explanation = heal.explanation;
        applyResults = healApply.applyResults ?? applyResults;
        for (const f of collectChangedFiles(healApply.applyResults)) {
          if (!filesChanged.includes(f)) filesChanged.push(f);
        }
      }
    } catch (healErr) {
      console.error('[job-runner] self-heal skipped:', healErr);
    }

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
      const doneMessage = opts.isEdit ? jt('job.changesLive') : jt('job.appReady');
      await appendMessages(opts.projectId, [
        { role: 'user', content: opts.prompt },
        ...(filesChanged.length > 0 ? [{ role: 'build', content: JSON.stringify(filesChanged) }] : []),
        { role: 'ai', content: explanation || jt('job.codeGenerated') },
        { role: 'system', content: doneMessage },
      ]);
    } catch (persistError) {
      // A failed snapshot must not fail an otherwise successful build — the
      // sandbox has the code; the client can persist on its next apply.
      console.error('[job-runner] snapshot persistence failed:', persistError);
      publishJobEvent(jobId, {
        stage: 'job',
        type: 'warning',
        message: jt('job.snapshotFailed'),
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
  key: 'database' | 'ai' | 'auth' | 'roles' | 'storage',
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
      (data.database?.status === 'ready' || data.ai?.status === 'ready' ||
        data.auth?.status === 'ready' || data.roles?.status === 'ready' ||
        data.storage?.status === 'ready'),
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
  lang: Lang,
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
      publishJobEvent(jobId, { stage: 'job', type: 'warning', message: translate(lang, 'job.tablesWarning') });
    } else if (Array.isArray(data.warnings)) {
      for (const w of data.warnings) {
        publishJobEvent(jobId, { stage: 'job', type: 'warning', message: String(w) });
      }
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
