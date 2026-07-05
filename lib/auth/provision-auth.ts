// Provision isolated auth for a project: one Zitadel org (tenant) + a public
// OIDC app. Idempotent — reuses existing records. Mirrors provision-schema.ts.

import {
  createOrg,
  createProject,
  createOidcApp,
  deleteOrg,
  isZitadelConfigured,
  zitadelIssuer,
} from './zitadel';
import { getProjectAuth } from '@/lib/db/repos';

export interface ProvisionedAuth {
  orgId: string;
  clientId: string;
  issuer: string;
}

// Origins a generated app is served from. The live sandbox origin is EPHEMERAL
// (a fresh E2B/Vercel-sandbox subdomain per session) and, once deployed, lives on
// the KSA/Netlify/Vercel domains — none known at provisioning time. Zitadel accepts
// glob wildcards in redirect URIs *only when the app is in devMode* (which our OIDC
// apps are), so we register a wildcard per host family instead of a fixed origin.
// A single `*` matches one URL segment (the sandbox subdomain), e.g.
// `https://*.e2b.app/auth/callback` matches `https://5173-abc123.e2b.app/auth/callback`.
export function appOriginGlobs(): string[] {
  const ksaApps = process.env.KSA_APPS_DOMAIN || 'apps.etlaq.sa';
  return [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://*.e2b.app', // E2B sandbox preview
    'https://*.e2b.dev', // E2B sandbox preview (legacy)
    'https://*.vercel.run', // Vercel sandbox preview
    `https://*.${ksaApps}`, // KSA deploy (*.apps.etlaq.sa)
    'https://*.netlify.app', // Netlify deploy
    'https://*.vercel.app', // Vercel deploy
  ];
}

// The OIDC login callback registered on the app (origin + /auth/callback).
export function defaultRedirects(): string[] {
  return appOriginGlobs().map((o) => `${o}/auth/callback`);
}

// post_logout_redirect_uri is the bare app origin (no path), so it needs its own
// wildcard list — reusing the /auth/callback list would make sign-out mismatch.
export function defaultPostLogout(): string[] {
  return appOriginGlobs();
}

export async function provisionProjectAuth(projectId: string): Promise<ProvisionedAuth> {
  if (!isZitadelConfigured()) {
    throw new Error(
      'Zitadel is not configured. Set ZITADEL_URL and ZITADEL_TOKEN to enable per-project auth.'
    );
  }

  // Idempotent: reuse an already-provisioned org/app.
  const existing = await getProjectAuth(projectId);
  if (existing?.orgId && existing?.clientId) {
    return {
      orgId: existing.orgId,
      clientId: existing.clientId,
      issuer: existing.issuer || zitadelIssuer(),
    };
  }

  const label = `etlaq-${projectId.slice(0, 8)}`;
  const { orgId } = await createOrg(label);
  const { projectId: zProjectId } = await createProject(orgId, 'app');
  const { clientId } = await createOidcApp(orgId, zProjectId, {
    name: 'web',
    redirectUris: defaultRedirects(),
    postLogoutUris: defaultPostLogout(),
  });

  return { orgId, clientId, issuer: zitadelIssuer() };
}

// Tear down a project's isolated auth: delete its Zitadel org, which cascades to
// the org's project, OIDC app and any users. Idempotent no-op when Zitadel isn't
// configured or the project never provisioned auth. Mirrors deprovisionProjectSchema.
export async function deprovisionProjectAuth(projectId: string): Promise<void> {
  if (!isZitadelConfigured()) return;
  const existing = await getProjectAuth(projectId);
  if (!existing?.orgId) return;
  await deleteOrg(existing.orgId);
}
