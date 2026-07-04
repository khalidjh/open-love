// Minimal Zitadel Management API client used to provision one isolated
// organization (tenant) + public OIDC app per Etlaq project.
//
// Requires two server-only env vars (set once Zitadel is hosted):
//   ZITADEL_URL    e.g. https://auth.etlaq.io   (also the OIDC issuer)
//   ZITADEL_TOKEN  a service-user PAT with org-creation rights
//
// Not exercised until a live Zitadel instance is configured; every call throws a
// clear error if the env is missing so the caller can degrade gracefully.

// `.env.example` ships placeholders (ZITADEL_URL=https://auth.your-ksa-domain,
// ZITADEL_TOKEN=your_zitadel_service_user_pat). A bare presence check treats those
// as "configured", so the platform steers apps to isolated auth and provisioning
// then fails against a fake endpoint. Reject empty/placeholder values so auth stays
// honestly dormant until a real Zitadel is hosted.
function realValue(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (!t || /your[-_]|changeme|placeholder|example\.com|your-ksa-domain/i.test(t)) return undefined;
  return t;
}

function config() {
  const url = realValue(process.env.ZITADEL_URL);
  const token = realValue(process.env.ZITADEL_TOKEN);
  if (!url || !token) {
    throw new Error(
      'Zitadel is not configured. Set ZITADEL_URL and ZITADEL_TOKEN to enable per-project auth.'
    );
  }
  return { url: url.replace(/\/$/, ''), token };
}

export function isZitadelConfigured() {
  return !!(realValue(process.env.ZITADEL_URL) && realValue(process.env.ZITADEL_TOKEN));
}

export function zitadelIssuer() {
  return (process.env.ZITADEL_URL || '').replace(/\/$/, '');
}

async function zfetch(path: string, init: RequestInit & { orgId?: string } = {}) {
  const { url, token } = config();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.orgId) headers['x-zitadel-orgid'] = init.orgId;
  const res = await fetch(`${url}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`Zitadel ${path} → ${res.status}: ${body.message || text}`);
  }
  return body;
}

/** Create an isolated organization (= the project's tenant). Returns its id. */
export async function createOrg(name: string): Promise<{ orgId: string }> {
  const body = await zfetch('/management/v1/orgs', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return { orgId: body.id };
}

/** Create a project container inside the org. */
export async function createProject(orgId: string, name: string): Promise<{ projectId: string }> {
  const body = await zfetch('/management/v1/projects', {
    method: 'POST',
    orgId,
    body: JSON.stringify({ name }),
  });
  return { projectId: body.id };
}

/** Create a public (PKCE) OIDC app for the generated web app. Returns the clientId. */
export async function createOidcApp(
  orgId: string,
  zProjectId: string,
  opts: { name: string; redirectUris: string[]; postLogoutUris?: string[] }
): Promise<{ clientId: string }> {
  const body = await zfetch(`/management/v1/projects/${zProjectId}/apps/oidc`, {
    method: 'POST',
    orgId,
    body: JSON.stringify({
      name: opts.name,
      redirectUris: opts.redirectUris,
      postLogoutRedirectUris: opts.postLogoutUris ?? opts.redirectUris,
      responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
      grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE', 'OIDC_GRANT_TYPE_REFRESH_TOKEN'],
      appType: 'OIDC_APP_TYPE_USER_AGENT', // SPA
      authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE', // public + PKCE, no client secret
      accessTokenType: 'OIDC_TOKEN_TYPE_JWT', // JWT access tokens PostgREST can verify
      // Generated apps log in from an EPHEMERAL sandbox origin (E2B) and, once
      // deployed, from <slug>.apps.etlaq.sa — neither is known when the app is
      // provisioned, so a fixed redirectUris allowlist would reject every real
      // login with a redirect_uri mismatch. devMode relaxes redirect-URI/origin
      // validation. Safe here: these are public PKCE SPA clients, so an auth code
      // sent to any URI is worthless without the PKCE verifier the real app holds.
      // Harden later (v2): register explicit sandbox + deploy URIs per app.
      devMode: true,
    }),
  });
  return { clientId: body.clientId };
}

/** Add/replace an app's allowed redirect URIs (e.g. when the Netlify domain is known). */
export async function updateOidcRedirects(
  orgId: string,
  zProjectId: string,
  appId: string,
  redirectUris: string[]
) {
  await zfetch(`/management/v1/projects/${zProjectId}/apps/${appId}/oidc_config`, {
    method: 'PUT',
    orgId,
    body: JSON.stringify({
      redirectUris,
      postLogoutRedirectUris: redirectUris,
      responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
      grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE', 'OIDC_GRANT_TYPE_REFRESH_TOKEN'],
      appType: 'OIDC_APP_TYPE_USER_AGENT',
      authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
      accessTokenType: 'OIDC_TOKEN_TYPE_JWT',
    }),
  });
}
