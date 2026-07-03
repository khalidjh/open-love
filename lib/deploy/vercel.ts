// Full-stack deploy: upload the app SOURCE to Vercel and let it build, so SSR +
// API routes run as serverless functions. The app reads the KSA-hosted Supabase
// over HTTPS — data stays resident in KSA, only transiently processed at Vercel.

import { getProjectDatabase, getProjectAuth } from '@/lib/db/repos';
import { decrypt } from '@/lib/crypto';

const VERCEL_API = 'https://api.vercel.com';

async function vercel(path: string, token: string, init: RequestInit = {}) {
  const teamId = process.env.VERCEL_TEAM_ID;
  const sep = path.includes('?') ? '&' : '?';
  const url = `${VERCEL_API}${path}${teamId ? `${sep}teamId=${teamId}` : ''}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let body: any = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!res.ok) {
    const message = body?.error?.message || (typeof body === 'string' ? body : '') || res.statusText;
    throw new Error(`Vercel API ${res.status}: ${message}`);
  }
  return body;
}

// Pull the project's KSA-Supabase + auth creds and split them by exposure.
// NEXT_PUBLIC_* ships to the browser (safe: URL + anon key + OIDC client id).
async function buildEnv(projectId: string) {
  const publicEnv: Record<string, string> = {};
  const secretEnv: Record<string, string> = {};

  const dbRec = await getProjectDatabase(projectId);
  if (dbRec?.encryptedCredentials) {
    try {
      const { url, anonKey, schema } = JSON.parse(decrypt(dbRec.encryptedCredentials));
      if (url) publicEnv.NEXT_PUBLIC_SUPABASE_URL = url;
      if (anonKey) publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
      if (schema) publicEnv.NEXT_PUBLIC_SUPABASE_SCHEMA = schema;
    } catch { /* ignore malformed creds */ }
  }

  const authRec = await getProjectAuth(projectId);
  if (authRec?.issuer) publicEnv.NEXT_PUBLIC_AUTH_ISSUER = authRec.issuer;
  if (authRec?.clientId) publicEnv.NEXT_PUBLIC_AUTH_CLIENT_ID = authRec.clientId;

  // TODO(phase2): server-only secrets go in secretEnv. Do NOT ship the shared
  // SUPABASE_SERVICE_ROLE_KEY to a tenant app — mint a per-project scoped key first.

  return { publicEnv, secretEnv };
}

export interface VercelDeployResult {
  url?: string;
  vercelProjectId: string;
  deployId: string;
  state: string;
}

export async function runVercelDeploy(
  provider: any,
  opts: { token: string; projectId: string; vercelProjectId?: string | null; siteName?: string; files: Record<string, string> }
): Promise<VercelDeployResult> {
  const { token, projectId, files } = opts;

  const projectName = (opts.siteName || `etlaq-${projectId}`)
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 100);

  // 1. Ensure a Vercel project exists (create once, reuse afterwards).
  let vercelProjectId = opts.vercelProjectId || undefined;
  if (vercelProjectId) {
    try { await vercel(`/v9/projects/${vercelProjectId}`, token); } catch { vercelProjectId = undefined; }
  }
  if (!vercelProjectId) {
    try {
      const created = await vercel('/v10/projects', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName, framework: 'nextjs' }),
      });
      vercelProjectId = created.id;
    } catch {
      const existing = await vercel(`/v9/projects/${projectName}`, token);
      vercelProjectId = existing.id;
    }
  }

  // 2. Upsert env vars, split public vs secret.
  const { publicEnv, secretEnv } = await buildEnv(projectId);
  const envEntries = [
    ...Object.entries(publicEnv).map(([key, value]) => ({ key, value, type: 'plain' as const })),
    ...Object.entries(secretEnv).map(([key, value]) => ({ key, value, type: 'encrypted' as const })),
  ];
  for (const entry of envEntries) {
    await vercel(`/v10/projects/${vercelProjectId}/env?upsert=true`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...entry, target: ['production', 'preview', 'development'] }),
    });
  }

  // 3. Create a production deployment from source (Vercel builds it).
  const fileList = Object.entries(files).map(([file, data]) => ({ file, data, encoding: 'utf-8' as const }));
  if (fileList.length === 0) throw new Error('No source files found in the sandbox.');

  let deploy = await vercel('/v13/deployments', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: projectName,
      project: vercelProjectId,
      target: 'production',
      files: fileList,
      projectSettings: { framework: 'nextjs' },
      // TODO(phase2): pin functions to the region nearest KSA (test fra1 vs bom1).
    }),
  });

  // 4. Poll until the build is ready.
  const deployId = deploy.id || deploy.uid;
  for (let i = 0; i < 90 && deploy.readyState !== 'READY'; i++) {
    if (deploy.readyState === 'ERROR' || deploy.readyState === 'CANCELED') break;
    await new Promise((r) => setTimeout(r, 3000));
    deploy = await vercel(`/v13/deployments/${deployId}`, token);
  }
  if (deploy.readyState !== 'READY') {
    throw new Error(`Vercel deploy ${deploy.readyState || 'did not finish'}.`);
  }

  return {
    url: deploy.url ? `https://${deploy.url}` : undefined,
    vercelProjectId: vercelProjectId as string,
    deployId,
    state: deploy.readyState,
  };
}
