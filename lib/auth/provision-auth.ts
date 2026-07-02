// Provision isolated auth for a project: one Zitadel org (tenant) + a public
// OIDC app. Idempotent — reuses existing records. Mirrors provision-schema.ts.

import {
  createOrg,
  createProject,
  createOidcApp,
  isZitadelConfigured,
  zitadelIssuer,
} from './zitadel';
import { getProjectAuth } from '@/lib/db/repos';

export interface ProvisionedAuth {
  orgId: string;
  clientId: string;
  issuer: string;
}

// Redirect URIs the SPA will use. The live sandbox origin isn't stable, so we
// register the common local + a placeholder; the Netlify domain is added at deploy.
function defaultRedirects(): string[] {
  return [
    'http://localhost:5173/auth/callback',
    'http://localhost:3000/auth/callback',
  ];
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
  });

  return { orgId, clientId, issuer: zitadelIssuer() };
}
