import { requireOrg } from '@/lib/auth';
import { getProject, getLatestVersion } from '@/lib/db/repos';
import type { Framework } from '@/lib/templates';

export interface FallbackSource {
  files: Record<string, string>;
  framework?: Framework;
}

/**
 * Build a durable fallback loader for sandbox recovery.
 *
 * ensureActiveSandbox() normally replays the in-memory file cache, which only
 * survives while the Node process stays up. If the process restarted (cache
 * lost), that cache is empty and recovery would rebuild a blank scaffold. This
 * loader reloads the project's latest saved files from the control-plane DB so
 * recovery restores the real app instead.
 *
 * Returns undefined when no projectId is known (nothing durable to fall back to),
 * and null at call time when the project/version can't be loaded or is empty.
 */
export function makeProjectFallback(projectId?: string): (() => Promise<FallbackSource | null>) | undefined {
  if (!projectId) return undefined;
  return async () => {
    try {
      const { orgId } = await requireOrg();
      const project = await getProject(orgId, projectId);
      if (!project) return null;
      const version = await getLatestVersion(projectId);
      const files = (version?.files ?? {}) as Record<string, string>;
      if (Object.keys(files).length === 0) return null;
      const framework: Framework = project.framework === 'nextjs' ? 'nextjs' : 'vite';
      return { files, framework };
    } catch (e) {
      console.error('[db-fallback] failed to load project snapshot:', e);
      return null;
    }
  };
}
