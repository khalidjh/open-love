// Full-stack deploy to the KSA runtime: build and run the generated Next.js app
// as a container ON THIS SERVER, fronted by Caddy at <slug>.<KSA_APPS_DOMAIN>.
// Unlike Vercel, SSR/API routes execute inside KSA — no PDPL transfer.
//
// Mechanics (host prerequisites are in docs/deploy-and-server-setup.md):
//   1. app source  → KSA_APPS_DIR/<slug>/app          (bind-mounted host dir)
//   2. build       → one-shot container: npm install && next build
//   3. run         → long-lived container, 127.0.0.1:<port> → 3000
//   4. route       → KSA_CADDY_APPS_DIR/<slug>.caddy; a systemd path unit
//                    watching that dir reloads Caddy (TLS via HTTP-01)

import fs from 'fs/promises';
import path from 'path';
import { buildEnv } from './env';
import { APPS_DOMAIN, APPS_DIR, RUNTIME_IMAGE, resolveSlug, safeJoin, writeCaddyVhost, waitForTls } from './ksa-shared';
import { withBuildSlot } from './build-gate';
import { injectBeaconIntoNextLayout } from '@/lib/analytics/beacon';
import {
  ensureImage, createAndStart, removeContainer, inspectContainer,
  runToCompletion, probeContainerHttp, usedHostPorts, containerLogs,
} from './docker';

const PORT_RANGE_START = 34000;
const PORT_RANGE_SIZE = 1000;
const BUILD_TIMEOUT_MS = 15 * 60 * 1000;

// Kept across redeploys so npm/next caches make rebuilds incremental.
const PRESERVED = new Set(['node_modules', '.next', '.npm-cache']);

export interface KsaDeployResult {
  url: string;
  slug: string;
  state: string;
}

async function syncSource(appDir: string, files: Record<string, string>) {
  await fs.mkdir(appDir, { recursive: true });
  // Drop stale entries from the previous deploy, keep dependency/build caches.
  for (const entry of await fs.readdir(appDir)) {
    if (!PRESERVED.has(entry)) await fs.rm(path.join(appDir, entry), { recursive: true, force: true });
  }
  for (const [rel, content] of Object.entries(files)) {
    const full = safeJoin(appDir, rel);
    if (!full) continue;
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
}

// .env.production.local outranks every env file a generated app could ship, and
// Next reads it at BUILD time (NEXT_PUBLIC_* inlining) and at runtime alike.
async function writeEnvFile(appDir: string, projectId: string, appName?: string) {
  const { publicEnv, secretEnv } = await buildEnv(projectId, { appName });
  const all = { ...publicEnv, ...secretEnv };
  const lines = Object.entries(all).map(([k, v]) => `${k}=${v}`);
  await fs.writeFile(path.join(appDir, '.env.production.local'), lines.join('\n') + '\n', 'utf8');
}

async function allocatePort(slug: string, containerName: string): Promise<number> {
  // Redeploy: keep the port the running (or stopped) app already has, so the
  // Caddy route stays valid even if the reload lags.
  const existing = await inspectContainer(containerName);
  const bound = existing?.HostConfig?.PortBindings?.['3000/tcp']?.[0]?.HostPort;
  if (bound) return parseInt(bound, 10);

  const used = await usedHostPorts();
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; i < PORT_RANGE_SIZE; i++) {
    const port = PORT_RANGE_START + ((hash + i) % PORT_RANGE_SIZE);
    if (!used.has(port)) return port;
  }
  throw new Error('No free port in the KSA app range.');
}

// Full-stack apps need a per-slug vhost (each runs on its own port), so unlike
// static they can't ride the shared `*.apps.etlaq.sa` wildcard block. Issuing
// their cert via DNS-01 (same token as the wildcard) avoids the HTTP-01 race —
// the cert is provisioned out-of-band instead of on the first TLS handshake, so
// the URL doesn't greet the user with ERR_SSL_PROTOCOL_ERROR. (Caddy needs
// DO_API_TOKEN in its environment; the host's caddy.env provides it.)
function writeCaddyRoute(slug: string, port: number) {
  return writeCaddyVhost(
    slug,
    `\ttls {\n\t\tdns digitalocean {env.DO_API_TOKEN}\n\t}\n\tencode gzip\n\treverse_proxy 127.0.0.1:${port}`
  );
}

export async function runKsaDeploy(opts: {
  projectId: string;
  siteName?: string;
  prevUrl?: string | null;
  files: Record<string, string>;
}): Promise<KsaDeployResult> {
  const { projectId, files } = opts;
  if (Object.keys(files).length === 0) throw new Error('No source files found in the sandbox.');

  const slug = resolveSlug(projectId, opts.siteName, opts.prevUrl);
  const appDir = path.join(APPS_DIR, slug, 'app');
  const runName = `etlaq-app-${slug}`;

  await syncSource(appDir, files);
  await writeEnvFile(appDir, projectId, opts.siteName);

  // Inject the visitor-analytics beacon into the root layout (Next apps have no
  // index.html, so the static-path injector can't reach them — without this,
  // published full-stack apps always report 0 views). Runs on the synced source
  // before the build so it's compiled in.
  const collectBase = process.env.ETLAQ_PUBLIC_URL;
  if (collectBase) {
    for (const rel of ['app/layout.jsx', 'app/layout.js', 'src/app/layout.jsx']) {
      const layoutPath = safeJoin(appDir, rel);
      if (!layoutPath) continue;
      try {
        const src = await fs.readFile(layoutPath, 'utf8');
        const injected = injectBeaconIntoNextLayout(src, projectId, collectBase);
        if (injected !== src) { await fs.writeFile(layoutPath, injected, 'utf8'); break; }
      } catch { /* layout not at this path — try next */ }
    }
  }

  await ensureImage(RUNTIME_IMAGE);

  // Build in a throwaway container. The app dir is bind-mounted, so node_modules
  // and .next land on the host and are reused by the runtime container. Each
  // build claims up to 2 GB, so gate concurrency to keep parallel deploys from
  // OOM-ing the shared VM — excess builds queue rather than all run at once.
  const build = await withBuildSlot(() => runToCompletion(
    `etlaq-build-${slug}`,
    {
      Image: RUNTIME_IMAGE,
      WorkingDir: '/app',
      // Same uid as the control app: every file in the bind-mounted dir stays
      // deletable/overwritable on the next redeploy, and tenant code isn't root.
      User: '1001:1001',
      Cmd: ['sh', '-c', 'npm install --no-audit --no-fund && npm run build'],
      Env: ['NEXT_TELEMETRY_DISABLED=1', 'npm_config_cache=/app/.npm-cache', 'CI=1', 'HOME=/app'],
      HostConfig: {
        Binds: [`${appDir}:/app`],
        Memory: 2 * 1024 * 1024 * 1024,
        MemorySwap: 2 * 1024 * 1024 * 1024, // = Memory: no swap on top of the cap
        NanoCpus: 2_000_000_000, // 2 CPUs — a build can't starve the shared VM
        PidsLimit: 1024, // npm spawns freely; still stops fork bombs
        CapDrop: ['ALL'], // tenant code needs no kernel capabilities
        SecurityOpt: ['no-new-privileges:true'],
        NetworkMode: 'bridge',
      },
    },
    BUILD_TIMEOUT_MS
  ));
  if (build.exitCode !== 0) {
    // Lead with something actionable for a non-technical user when we recognize
    // the failure; the raw tail still follows for debugging.
    const friendly = /window is not defined/.test(build.logs)
      ? 'Your app uses browser-only features while pages are being pre-built. ' +
        'Ask the assistant: "fix window is not defined during the production build", then publish again.\n\n'
      : '';
    throw new Error(`App build failed (exit ${build.exitCode}):\n${friendly}${build.logs.slice(-2000)}`);
  }

  const port = await allocatePort(slug, runName);
  await createAndStart(runName, {
    Image: RUNTIME_IMAGE,
    WorkingDir: '/app',
    User: '1001:1001',
    Cmd: ['sh', '-c', 'npm start -- -p 3000'],
    Env: ['NODE_ENV=production', 'NEXT_TELEMETRY_DISABLED=1', 'HOME=/app'],
    ExposedPorts: { '3000/tcp': {} },
    HostConfig: {
      Binds: [`${appDir}:/app`],
      PortBindings: { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: String(port) }] },
      RestartPolicy: { Name: 'unless-stopped' },
      Memory: 1024 * 1024 * 1024,
      MemorySwap: 1024 * 1024 * 1024, // = Memory: no swap on top of the cap
      NanoCpus: 1_000_000_000, // 1 CPU per tenant app
      PidsLimit: 256, // a Next server needs few processes; stops fork bombs
      CapDrop: ['ALL'], // tenant code needs no kernel capabilities
      SecurityOpt: ['no-new-privileges:true'],
      NetworkMode: 'bridge',
    },
  });

  const up = await probeContainerHttp(runName, 3000);
  if (!up) {
    const logs = await containerLogs(runName).catch(() => '');
    await removeContainer(runName).catch(() => {});
    throw new Error(`App started but never answered HTTP:\n${logs.slice(-2000)}`);
  }

  await writeCaddyRoute(slug, port);

  // Wait for the subdomain to serve over TLS before reporting READY — see
  // waitForTls: Caddy issues the per-subdomain cert in the background, and an
  // early success sends the user to an ERR_SSL_PROTOCOL_ERROR page.
  const url = `https://${slug}.${APPS_DOMAIN}`;
  const tlsReady = await waitForTls(url);
  return { url, slug, state: tlsReady ? 'READY' : 'provisioning' };
}
