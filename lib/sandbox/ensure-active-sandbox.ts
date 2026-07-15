import { SandboxFactory } from './factory';
import { sandboxManager } from './sandbox-manager';
import { updateProject } from '@/lib/db/repos';
import type { SandboxProvider } from './types';
import type { SandboxSession } from './session-store';
import type { Framework } from '@/lib/templates';

export interface EnsureResult {
  provider: SandboxProvider;
  sandboxData: { sandboxId: string; url: string };
  recreated: boolean;
}

export interface EnsureOptions {
  // The authenticated project's session — the sole source/target of sandbox
  // state. All reads/writes go through here, never through process globals, so
  // recovery is scoped to one tenant's project.
  session: SandboxSession;
  orgId: string;
  projectId: string;
  // Durable fallback for the files to replay when the session's file cache is
  // empty (e.g. the Node process restarted). Typically a DB-snapshot loader.
  // Only invoked on the recovery path, and only when the cache has nothing.
  loadFallback?: () => Promise<{ files: Record<string, string>; framework?: Framework } | null>;
  // The sandboxId persisted on the project row. After a process restart the
  // in-memory session is gone but the sandbox itself often survives — this id
  // lets recovery re-attach to it instead of rebuilding from scratch.
  lastSandboxId?: string | null;
}

// Snapshot the session's file cache as a flat path -> content map. The cache
// stores { content, lastModified } objects, but tolerate raw strings too.
function cachedFiles(session: SandboxSession): Record<string, string> {
  const cache = session.fileCache?.files || {};
  const out: Record<string, string> = {};
  for (const [path, entry] of Object.entries(cache)) {
    const content = typeof entry === 'string' ? entry : (entry as { content?: string })?.content;
    if (typeof content === 'string') out[path] = content;
  }
  return out;
}

/**
 * Guarantee a live sandbox for one project, transparently recovering a reaped one.
 *
 * The common failure mode this fixes: E2B garbage-collects the microVM after its
 * TTL, leaving the project pointing at a dead sandbox URL ("Sandbox Not Found").
 * As long as the session's in-memory file cache is intact we rebuild an identical
 * sandbox and replay the generated files; if the process restarted and the cache
 * is gone we replay from the project's latest DB snapshot instead.
 *
 * Fast path: existing sandbox pings OK -> refresh its TTL and return it.
 * Recovery path: sandbox is gone -> create a fresh one, re-scaffold the same
 * framework, replay the files, reinstall deps, restart the dev server, re-wire the
 * session, and persist the new sandboxId to the project row.
 */
export async function ensureActiveSandbox(opts: EnsureOptions): Promise<EnsureResult> {
  const { session, orgId, projectId } = opts;
  const existing = session.provider;

  if (existing) {
    const alive = await existing.ping().catch(() => false);
    if (alive) {
      await existing.keepAlive().catch(() => {});
      const info = existing.getSandboxInfo();
      return {
        provider: existing,
        sandboxData: {
          sandboxId: info?.sandboxId ?? session.sandboxData?.sandboxId ?? '',
          url: info?.url ?? session.sandboxData?.url ?? '',
        },
        recreated: false,
      };
    }
  }

  // --- Recovery path ---
  let files = cachedFiles(session);
  let framework: Framework = session.framework || 'vite';

  // If the session's file cache is empty (the Node process likely restarted and
  // lost it), fall back to the durable DB snapshot so we rebuild the real app
  // rather than a blank scaffold.
  if (Object.keys(files).length === 0 && opts.loadFallback) {
    const fallback = await opts.loadFallback().catch(() => null);
    if (fallback && Object.keys(fallback.files).length > 0) {
      files = fallback.files;
      if (fallback.framework) framework = fallback.framework;
    }
  }

  const paths = Object.keys(files);

  // Drop this project's dead handle so nothing else tries to reuse it. Note we
  // only tear down THIS session's provider — never other tenants' sandboxes.
  // Unregister its manager entry too so the bookkeeping map doesn't accumulate
  // dead sandboxes over the container's lifetime.
  const deadId = session.sandboxData?.sandboxId;
  if (deadId) await sandboxManager.terminateSandbox(deadId).catch(() => {});
  if (session.provider) {
    try { await session.provider.terminate(); } catch { /* best-effort */ }
    session.provider = null;
  }

  // Cheap path first: if this session had no live handle (process restart), the
  // sandbox itself may still be running — re-attach instead of rebuilding.
  // Skip ids we just ping-failed/terminated; only a persisted id from a *previous*
  // process is worth trying.
  const reconnectId = opts.lastSandboxId && opts.lastSandboxId !== deadId ? opts.lastSandboxId : null;
  if (reconnectId) {
    const candidate = SandboxFactory.create();
    const reattached = await candidate.reconnect(reconnectId).catch(() => false);
    if (reattached) {
      const info = candidate.getSandboxInfo();
      if (info) {
        console.log('[ensureActiveSandbox] re-attached to surviving sandbox', reconnectId);
        sandboxManager.registerSandbox(info.sandboxId, candidate);
        session.provider = candidate;
        session.framework = framework;
        session.sandboxData = { sandboxId: info.sandboxId, url: info.url };
        // The sandbox already holds these files; cache them for context selection.
        session.fileCache = {
          files: Object.fromEntries(
            paths.map((p) => [p, { content: files[p], lastModified: Date.now() }])
          ),
          lastSync: Date.now(),
          sandboxId: info.sandboxId,
        };
        session.existingFiles = new Set([...session.existingFiles, ...paths]);
        return {
          provider: candidate,
          sandboxData: { sandboxId: info.sandboxId, url: info.url },
          recreated: false,
        };
      }
    }
  }

  // --- Full rebuild and replay ---
  const provider = SandboxFactory.create();
  const info = await provider.createSandbox();

  // Re-scaffold the same framework this project was using.
  if (framework === 'nextjs') await provider.setupNextApp();
  else await provider.setupViteApp();

  // Replay generated files over the fresh scaffold in one batch write.
  try {
    await provider.writeFiles(paths.map((p) => ({ path: p, content: files[p] })));
  } catch (e) {
    console.error('[ensureActiveSandbox] batch replay failed, retrying per-file', e);
    for (const path of paths) {
      try {
        await provider.writeFile(path, files[path]);
      } catch (err) {
        console.error('[ensureActiveSandbox] failed to replay', path, err);
      }
    }
  }

  // If the app brought its own package.json, reinstall deps then restart the
  // dev server so the replayed app actually boots.
  if (paths.some((p) => p.endsWith('package.json'))) {
    try { await provider.runShell('npm install'); } catch (e) { console.error('[ensureActiveSandbox] npm install failed', e); }
  }
  if (paths.length) {
    try {
      if (framework === 'nextjs') await provider.restartNextServer();
      else await provider.restartViteServer();
    } catch (e) {
      console.error('[ensureActiveSandbox] dev server restart failed', e);
    }
  }

  // Re-wire the project's session to the fresh sandbox.
  sandboxManager.registerSandbox(info.sandboxId, provider);
  session.provider = provider;
  session.framework = framework;
  session.sandboxData = { sandboxId: info.sandboxId, url: info.url };
  session.fileCache = {
    files: Object.fromEntries(
      paths.map((p) => [p, { content: files[p], lastModified: Date.now() }])
    ),
    lastSync: Date.now(),
    sandboxId: info.sandboxId,
  };
  session.existingFiles = new Set([...session.existingFiles, ...paths]);

  await provider.keepAlive().catch(() => {});

  // Persist the new binding so a returning session / fresh process knows which
  // sandbox this project last used (and can rebuild from the DB snapshot).
  try {
    await updateProject(orgId, projectId, {
      sandboxId: info.sandboxId,
      sandboxProvider: (process.env.SANDBOX_PROVIDER || 'e2b') as string,
    });
  } catch (e) {
    console.error('[ensureActiveSandbox] failed to persist sandbox binding', e);
  }

  return {
    provider,
    sandboxData: { sandboxId: info.sandboxId, url: info.url },
    recreated: true,
  };
}
