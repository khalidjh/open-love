// Static deploy: build the app in the sandbox and push the pre-built dist/ to
// Netlify as a zip. No server runs on Netlify — the browser talks directly to
// the KSA-hosted Supabase.

const NETLIFY_API = 'https://api.netlify.com/api/v1';

async function netlify(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${NETLIFY_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let body: any = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!res.ok) {
    // Netlify surfaces 422 detail in `errors` (e.g. { subdomain: ["must be unique"] }),
    // not `message` — include it so the failure isn't an opaque "Unprocessable Entity".
    const message =
      body?.message ||
      (body?.errors ? JSON.stringify(body.errors) : '') ||
      (typeof body === 'string' ? body : '') ||
      res.statusText;
    throw new Error(`Netlify API ${res.status}: ${message}`);
  }
  return body;
}

// Netlify site names become the subdomain, so they must be lowercase, alphanumeric
// + hyphens, and <= 63 chars. Slugify the human project name to fit.
function slugifyNetlifyName(name?: string): string | undefined {
  if (!name) return undefined;
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  return slug || undefined;
}

export interface NetlifyDeployResult {
  url?: string;
  siteId: string;
  deployId: string;
  state: string;
  adminUrl?: string;
}

export async function runNetlifyDeploy(
  provider: any,
  opts: { token: string; siteId?: string; siteName?: string }
): Promise<NetlifyDeployResult> {
  const { token } = opts;

  // 1. Build inside the sandbox.
  const build = await provider.runShell('npm run build');
  if (!build.success) {
    throw new Error(`Build failed: ${build.stderr || build.stdout || 'unknown error'}`);
  }

  // 2. SPA fallback so client-side routing works on Netlify.
  await provider.runShell('echo "/* /index.html 200" > dist/_redirects');

  // 3. Zip the built output and read it out of the sandbox.
  const zip = await provider.runShell('cd dist && rm -f /tmp/netlify-deploy.zip && zip -r /tmp/netlify-deploy.zip .');
  if (!zip.success) {
    throw new Error(`Failed to zip build output: ${zip.stderr || zip.stdout}`);
  }
  const base64 = await provider.readBinaryFileBase64('/tmp/netlify-deploy.zip');
  const zipBuffer = Buffer.from(base64, 'base64');

  // 4. Ensure a site exists (verify the passed-in one, else create).
  let siteId = opts.siteId;
  if (siteId) {
    try { await netlify(`/sites/${siteId}`, token); } catch { siteId = undefined; }
  }
  if (!siteId) {
    const name = slugifyNetlifyName(opts.siteName);
    let site;
    try {
      site = await netlify('/sites', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name ? { name } : {}),
      });
    } catch (e) {
      // A chosen name can collide globally (Netlify subdomains are unique) or be
      // otherwise rejected (422). Fall back to a Netlify-generated name so the
      // deploy still succeeds — the returned siteId is persisted and reused next
      // time, so the random name only appears on this first publish.
      if (name && /Netlify API 422/.test((e as Error).message)) {
        site = await netlify('/sites', token, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
      } else {
        throw e;
      }
    }
    siteId = site.id;
  }

  // 5. Deploy the zip and poll until live.
  let deploy = await netlify(`/sites/${siteId}/deploys`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zipBuffer,
  });
  const deployId = deploy.id;
  for (let i = 0; i < 30 && deploy.state !== 'ready'; i++) {
    if (deploy.state === 'error') break;
    await new Promise((r) => setTimeout(r, 2000));
    deploy = await netlify(`/sites/${siteId}/deploys/${deployId}`, token);
  }
  if (deploy.state === 'error') {
    throw new Error(`Netlify deploy failed: ${deploy.error_message || 'unknown error'}`);
  }

  return {
    url: deploy.ssl_url || deploy.deploy_ssl_url || deploy.url,
    siteId: siteId as string,
    deployId,
    state: deploy.state,
    adminUrl: deploy.admin_url,
  };
}
