// Static deploy to the KSA runtime: build the app in the sandbox and serve the
// pre-built dist/ straight from Caddy on THIS server at <slug>.<APPS_DOMAIN>.
// No container runs — Caddy is the file server; the browser talks directly to
// the KSA-hosted Supabase. Replaces the Netlify path (no free-tier limit, and
// it keeps static hosting in-KSA too).
//
// Mechanics (host prerequisites are in docs/static-deploy-via-caddy.md):
//   1. build   → in the sandbox: `npm run build`  (same as the old Netlify path)
//   2. pull    → tar dist/ and read it out as base64 (robust for binary assets;
//                per-file text reads corrupt images/fonts)
//   3. place   → extract into APPS_DIR/<slug>/public via a throwaway container
//                (the control image is slim and lacks unzip; node:22-slim has tar)
//   4. route   → APPS_DIR/<slug>.caddy with root+file_server+SPA fallback; the
//                same systemd path unit reloads Caddy (TLS via HTTP-01)

import fs from 'fs/promises';
import path from 'path';
import { APPS_DOMAIN, APPS_DIR, CADDY_APPS_DIR, RUNTIME_IMAGE, resolveSlug, waitForTls } from './ksa-shared';
import { ensureImage, runToCompletion } from './docker';

const EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;

export interface KsaStaticDeployResult {
  url: string;
  slug: string;
  state: string;
}

// Static apps no longer get a per-slug Caddy vhost. A single wildcard site block
// on the host — `*.apps.etlaq.sa { root * /opt/etlaq-apps/{labels.3}/public; … }`,
// served under one wildcard TLS cert (DNS-01) — routes every slug by its
// subdomain label. That means a new app is served over HTTPS the instant its
// files land (the wildcard cert already exists): no per-subdomain ACME issuance,
// no TLS handshake race, no Let's Encrypt rate limits. See
// docs/static-deploy-via-caddy.md. We only clean up a stale per-slug file left
// by the old model, so a redeploy of a pre-wildcard project stops double-serving.
async function removeLegacyStaticRoute(slug: string): Promise<void> {
  await fs.rm(path.join(CADDY_APPS_DIR, `${slug}.caddy`), { force: true });
}

export async function runKsaStaticDeploy(
  provider: any,
  opts: { projectId: string; siteName?: string; prevUrl?: string | null }
): Promise<KsaStaticDeployResult> {
  const slug = resolveSlug(opts.projectId, opts.siteName, opts.prevUrl);
  const slugDir = path.join(APPS_DIR, slug);
  const publicDir = path.join(slugDir, 'public');

  // 1. Build inside the sandbox (same step the Netlify path used).
  const build = await provider.runShell('npm run build');
  if (!build.success) {
    throw new Error(`Build failed: ${build.stderr || build.stdout || 'unknown error'}`);
  }
  // Vite emits to dist/ by default; fail clearly if it didn't.
  const check = await provider.runShell('test -d dist && echo __ok__');
  if (!/__ok__/.test(check.stdout)) {
    throw new Error('Build succeeded but produced no dist/ directory. Is this a Vite app?');
  }

  // 2. Archive dist/ and read it out as base64 — a tarball round-trips binary
  //    assets (images, fonts) intact, which per-file text reads would corrupt.
  const tar = await provider.runShell('cd dist && rm -f /tmp/site.tgz && tar czf /tmp/site.tgz .');
  if (!tar.success) {
    throw new Error(`Failed to archive dist/: ${tar.stderr || tar.stdout || 'unknown error'}`);
  }
  const base64 = await provider.readBinaryFileBase64('/tmp/site.tgz');
  const tgz = Buffer.from(base64, 'base64');

  // 3. Lay down a fresh slug dir on the host. Static has no caches worth keeping
  //    (unlike the full-stack node_modules/.next), so wipe and recreate.
  await fs.rm(slugDir, { recursive: true, force: true });
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(slugDir, 'site.tgz'), tgz);

  // 4. Extract in a throwaway container: uid 1001 keeps files redeploy-writable
  //    (same as the full-stack path), and `chmod a+rX` guarantees the Caddy user
  //    can read them regardless of which user Caddy runs as. No network needed.
  await ensureImage(RUNTIME_IMAGE);
  const extract = await runToCompletion(
    `etlaq-static-${slug}`,
    {
      Image: RUNTIME_IMAGE,
      WorkingDir: '/work',
      User: '1001:1001',
      Cmd: [
        'sh', '-c',
        'tar xzf /work/site.tgz -C /work/public && rm -f /work/site.tgz && chmod -R a+rX /work/public',
      ],
      HostConfig: {
        Binds: [`${slugDir}:/work`],
        NetworkMode: 'none',
        Memory: 512 * 1024 * 1024,
      },
    },
    EXTRACT_TIMEOUT_MS
  );
  if (extract.exitCode !== 0) {
    throw new Error(`Failed to unpack static build (exit ${extract.exitCode}):\n${extract.logs.slice(-2000)}`);
  }

  // 5. Routing is handled by the host's wildcard vhost (see above); just clear
  //    any legacy per-slug file so an old project stops being double-served.
  await removeLegacyStaticRoute(slug);

  // 6. Confirm the URL actually serves over TLS before reporting READY. With the
  //    wildcard cert this passes on the first poll (cert already exists); the
  //    poll is the safety net if that ever isn't true, so we never hand the user
  //    a link that greets them with ERR_SSL_PROTOCOL_ERROR.
  const url = `https://${slug}.${APPS_DOMAIN}`;
  const tlsReady = await waitForTls(url);
  return { url, slug, state: tlsReady ? 'READY' : 'provisioning' };
}
