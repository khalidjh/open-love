import { SandboxFactory } from './factory';
import { sandboxManager } from './sandbox-manager';
import type { SandboxProvider } from './types';
import type { SandboxState } from '@/types/sandbox';
import type { Framework } from '@/lib/templates';

declare global {
  var activeSandboxProvider: any;
  var sandboxData: any;
  var existingFiles: Set<string>;
  var sandboxState: SandboxState;
  var activeFramework: Framework | undefined;
}

export interface EnsureResult {
  provider: SandboxProvider;
  sandboxData: { sandboxId: string; url: string };
  recreated: boolean;
}

function currentProvider(): SandboxProvider | null {
  return sandboxManager.getActiveProvider() || global.activeSandboxProvider || null;
}

// Snapshot the in-memory file cache as a flat path -> content map. The cache
// stores { content, lastModified } objects, but tolerate raw strings too.
function cachedFiles(): Record<string, string> {
  const cache = global.sandboxState?.fileCache?.files || {};
  const out: Record<string, string> = {};
  for (const [path, entry] of Object.entries(cache)) {
    const content = typeof entry === 'string' ? entry : (entry as any)?.content;
    if (typeof content === 'string') out[path] = content;
  }
  return out;
}

/**
 * Guarantee a live sandbox, transparently recovering from a reaped one.
 *
 * The common failure mode this fixes: E2B garbage-collects the microVM after its
 * TTL, leaving the app pointing at a dead sandbox URL ("Sandbox Not Found"). As
 * long as the Node process is still alive (its in-memory file cache intact), we
 * can rebuild an identical sandbox and replay the generated files so the user's
 * app comes back without them noticing.
 *
 * Fast path: existing sandbox pings OK -> just refresh its TTL and return it.
 * Recovery path: sandbox is gone -> create a fresh one, re-scaffold the same
 * framework, replay the cached files, reinstall deps, restart the dev server,
 * and re-wire global + manager state.
 */
export async function ensureActiveSandbox(): Promise<EnsureResult> {
  const existing = currentProvider();

  if (existing) {
    const alive = await existing.ping().catch(() => false);
    if (alive) {
      await existing.keepAlive().catch(() => {});
      const info = existing.getSandboxInfo();
      return {
        provider: existing,
        sandboxData: {
          sandboxId: info?.sandboxId ?? global.sandboxData?.sandboxId,
          url: info?.url ?? global.sandboxData?.url,
        },
        recreated: false,
      };
    }
  }

  // --- Recovery path: rebuild and replay ---
  const files = cachedFiles();
  const paths = Object.keys(files);
  const framework: Framework = global.activeFramework || 'vite';

  // Drop the dead handles so nothing else tries to reuse them.
  try { await sandboxManager.terminateAll(); } catch { /* best-effort */ }
  if (global.activeSandboxProvider) {
    try { await global.activeSandboxProvider.terminate(); } catch { /* best-effort */ }
    global.activeSandboxProvider = null;
  }

  const provider = SandboxFactory.create();
  const info = await provider.createSandbox();

  // Re-scaffold the same framework this session was using.
  if (framework === 'nextjs') await provider.setupNextApp();
  else await provider.setupViteApp();

  // Replay generated files over the fresh scaffold.
  for (const path of paths) {
    try {
      await provider.writeFile(path, files[path]);
    } catch (e) {
      console.error('[ensureActiveSandbox] failed to replay', path, e);
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

  // Re-wire global + manager state to the fresh sandbox.
  sandboxManager.registerSandbox(info.sandboxId, provider);
  global.activeSandboxProvider = provider;
  global.sandboxData = { sandboxId: info.sandboxId, url: info.url };
  global.sandboxState = {
    fileCache: {
      files: Object.fromEntries(
        paths.map((p) => [p, { content: files[p], lastModified: Date.now() }])
      ),
      lastSync: Date.now(),
      sandboxId: info.sandboxId,
    },
    sandbox: provider,
    sandboxData: { sandboxId: info.sandboxId, url: info.url },
  };
  global.existingFiles = new Set([...(global.existingFiles ?? []), ...paths]);

  await provider.keepAlive().catch(() => {});

  return {
    provider,
    sandboxData: { sandboxId: info.sandboxId, url: info.url },
    recreated: true,
  };
}
