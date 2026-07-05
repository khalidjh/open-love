// =============================================================================
// Teardown for published apps on the KSA runtime — the inverse of ksa.ts /
// ksa-static.ts. Used to UNPUBLISH (take a live app offline) and as the first
// step of deleting a project.
//
// A published app leaves up to three artifacts on the VM, depending on target:
//   • full-stack: a long-lived container `etlaq-app-<slug>`, a Caddy vhost
//     `/etc/caddy/apps.d/<slug>.caddy`, and the app dir `/opt/etlaq-apps/<slug>`
//   • static:     just the app dir `/opt/etlaq-apps/<slug>` (served by the shared
//     wildcard vhost) — plus, on legacy projects, a stale `<slug>.caddy`
//
// Removing all of them is safe for either target: `removeContainer` swallows 404,
// and `fs.rm(..., { force: true })` swallows ENOENT, so this is fully idempotent
// and needs no branching. Removing the vhost file (or the app dir) is picked up
// by the caddy-apps.path systemd watcher, which reloads Caddy — no reload call
// needed here (see ksa-shared.ts).
// =============================================================================

import fs from 'fs/promises';
import path from 'path';
import { APPS_DIR, CADDY_APPS_DIR, resolveSlug } from './ksa-shared';
import { removeContainer } from './docker';

export interface TeardownTarget {
  id: string;
  name?: string | null;
  deployUrl?: string | null;
}

// Recover the deployed slug the same way redeploy does: prefer the one captured
// in deployUrl (stable across renames), else recompute from id + name.
function slugFor(project: TeardownTarget): string {
  return resolveSlug(project.id, project.name ?? undefined, project.deployUrl ?? undefined);
}

// Take a published app fully offline and delete its on-disk footprint. No-op if
// the project was never published. Throws only if the running container can't be
// removed (i.e. the app may still be live) — file removals are best-effort.
export async function runKsaTeardown(project: TeardownTarget): Promise<void> {
  if (!project.deployUrl) return;
  const slug = slugFor(project);

  // 1. Stop + remove the runtime container (full-stack). `force=true` covers
  //    stop+remove; a 404 (static app, or already gone) is swallowed. Let a real
  //    Docker failure propagate — the app would otherwise still be serving.
  await removeContainer(`etlaq-app-${slug}`);

  // 2. Remove the per-app Caddy vhost (full-stack, or a legacy static route).
  //    The systemd watcher reloads Caddy on this change.
  await fs.rm(path.join(CADDY_APPS_DIR, `${slug}.caddy`), { force: true }).catch((e) => {
    console.error(`[teardown] failed to remove caddy vhost for ${slug}:`, e);
  });

  // 3. Remove the app dir (built files, node_modules/.next caches for full-stack;
  //    the served public/ for static). Frees the disk the app was holding.
  await fs.rm(path.join(APPS_DIR, slug), { recursive: true, force: true }).catch((e) => {
    console.error(`[teardown] failed to remove app dir for ${slug}:`, e);
  });
}
