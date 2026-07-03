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
