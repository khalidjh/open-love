import type { SandboxProvider } from './types';
import type { SandboxFileCache } from '@/types/sandbox';
import type { ConversationState } from '@/types/conversation';
import type { Framework } from '@/lib/templates';

// =============================================================================
// Per-project sandbox session store.
//
// Historically all sandbox runtime state lived in process globals
// (global.activeSandboxProvider, sandboxData, sandboxState, existingFiles,
// activeFramework, conversationState). On a multi-tenant server that is a single
// shared slot: two logged-in users end up pointed at the SAME sandbox, and one
// user's build/chat leaks into another's preview.
//
// This store keys that state by projectId instead, so every tenant/project gets
// its own isolated session. Routes resolve the session for the authenticated
// project (see require-project-session.ts) rather than reaching for a global.
// =============================================================================

export interface SandboxSession {
  projectId: string;
  provider: SandboxProvider | null;
  sandboxData: { sandboxId: string; url: string } | null;
  fileCache: SandboxFileCache | null;
  existingFiles: Set<string>;
  framework: Framework;
  conversationState: ConversationState | null;
  // Per-project creation lock so concurrent create/ensure calls for the same
  // project coalesce instead of racing (replaces the old process-global lock).
  creationLock: Promise<unknown> | null;
  // Per-project dev-server restart throttle (replaces the old global vite flags).
  viteRestartInProgress?: boolean;
  lastViteRestartTime?: number;
  lastAccessed: number;
}

type Store = Map<string, SandboxSession>;

// Pin the map to globalThis so Next.js dev HMR (which re-evaluates modules on hot
// reload) doesn't drop live sessions — same survival trick as global.sandboxManager.
const g = globalThis as unknown as { __etlaqSandboxSessions?: Store };
const store: Store = g.__etlaqSandboxSessions ?? (g.__etlaqSandboxSessions = new Map());

function freshSession(projectId: string): SandboxSession {
  return {
    projectId,
    provider: null,
    sandboxData: null,
    fileCache: null,
    existingFiles: new Set<string>(),
    framework: 'vite',
    conversationState: null,
    creationLock: null,
    lastAccessed: Date.now(),
  };
}

export function getSession(projectId: string): SandboxSession | undefined {
  const s = store.get(projectId);
  if (s) s.lastAccessed = Date.now();
  return s;
}

export function getOrCreateSession(projectId: string): SandboxSession {
  let s = store.get(projectId);
  if (!s) {
    s = freshSession(projectId);
    store.set(projectId, s);
  }
  s.lastAccessed = Date.now();
  return s;
}

export function deleteSession(projectId: string): void {
  store.delete(projectId);
}

// =============================================================================
// Idle-session GC.
//
// Sessions (and the provider handles inside them) were previously immortal: on a
// long-running server the map grew with every project ever opened. E2B reaps the
// actual microVM after its TTL anyway, so a session idle for hours holds only a
// dead handle + stale file cache — safe to drop. Anything the user returns to
// later is rebuilt from the project's DB snapshot (see ensure-active-sandbox).
// =============================================================================

const SESSION_IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2h idle — far beyond E2B's 30-min sandbox TTL
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

async function sweepIdleSessions(): Promise<void> {
  const now = Date.now();
  for (const [projectId, s] of store) {
    if (now - s.lastAccessed <= SESSION_IDLE_TTL_MS) continue;
    store.delete(projectId);
    // Best-effort teardown of the (almost certainly already-reaped) sandbox and
    // its bookkeeping entry. Lazy import avoids a module-load cycle.
    const sandboxId = s.sandboxData?.sandboxId;
    const provider = s.provider;
    try {
      if (sandboxId) {
        const { sandboxManager } = await import('./sandbox-manager');
        await sandboxManager.terminateSandbox(sandboxId);
      }
      if (provider) await provider.terminate();
    } catch { /* best-effort */ }
  }
}

// Pin the sweeper to globalThis (HMR-safe, single instance) and unref it so it
// never keeps the process alive on shutdown.
const gs = globalThis as unknown as { __etlaqSandboxSweeper?: ReturnType<typeof setInterval> };
if (!gs.__etlaqSandboxSweeper) {
  gs.__etlaqSandboxSweeper = setInterval(() => { void sweepIdleSessions(); }, SWEEP_INTERVAL_MS);
  gs.__etlaqSandboxSweeper.unref?.();
}
