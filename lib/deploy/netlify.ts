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
    const message = body?.message || (typeof body === 'string' ? body : '') || res.statusText;
    throw new Error(`Netlify API ${res.status}: ${message}`);
  }
  return body;
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
    const site = await netlify('/sites', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.siteName ? { name: opts.siteName } : {}),
    });
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
