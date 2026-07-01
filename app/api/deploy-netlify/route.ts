import { NextRequest, NextResponse } from 'next/server';

declare global {
  // Provider wrapper set by create-ai-sandbox-v2
  var activeSandboxProvider: any;
  // Remember the Netlify site so repeat deploys keep the same URL
  var netlifySiteId: string | undefined;
}

const NETLIFY_API = 'https://api.netlify.com/api/v1';

async function netlify(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${NETLIFY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let body: any = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!res.ok) {
    const message = (body && body.message) || (typeof body === 'string' ? body : '') || res.statusText;
    throw new Error(`Netlify API ${res.status}: ${message}`);
  }
  return body;
}

export async function POST(request: NextRequest) {
  try {
    const token = process.env.NETLIFY_API_KEY;
    if (!token) {
      return NextResponse.json(
        { success: false, error: 'NETLIFY_API_KEY is not set. Add it to .env.local and restart the dev server.' },
        { status: 400 }
      );
    }

    const provider = global.activeSandboxProvider;
    if (!provider) {
      return NextResponse.json(
        { success: false, error: 'No active sandbox. Generate an app first.' },
        { status: 400 }
      );
    }

    let siteName: string | undefined;
    let siteId: string | undefined;
    try {
      const parsed = await request.json();
      siteName = parsed?.siteName;
      siteId = parsed?.siteId;
    } catch {
      // body is optional
    }
    siteId = siteId || global.netlifySiteId;

    // 1. Build the app inside the sandbox
    console.log('[deploy-netlify] Building app...');
    const build = await provider.runShell('npm run build');
    if (!build.success) {
      return NextResponse.json(
        { success: false, error: `Build failed: ${build.stderr || build.stdout || 'unknown error'}` },
        { status: 500 }
      );
    }

    // 2. SPA fallback so client-side routing works on Netlify
    await provider.runShell('echo "/* /index.html 200" > dist/_redirects');

    // 3. Zip the built output
    console.log('[deploy-netlify] Zipping dist/...');
    const zip = await provider.runShell('cd dist && rm -f /tmp/netlify-deploy.zip && zip -r /tmp/netlify-deploy.zip .');
    if (!zip.success) {
      return NextResponse.json(
        { success: false, error: `Failed to zip build output: ${zip.stderr || zip.stdout}` },
        { status: 500 }
      );
    }

    // 4. Read the zip out of the sandbox
    const base64 = await provider.readBinaryFileBase64('/tmp/netlify-deploy.zip');
    const zipBuffer = Buffer.from(base64, 'base64');

    // 5. Ensure we have a Netlify site (create once, reuse afterwards)
    if (siteId) {
      // Verify the remembered site still exists; if not, fall through to create
      try {
        await netlify(`/sites/${siteId}`, token);
      } catch {
        siteId = undefined;
      }
    }
    if (!siteId) {
      const site = await netlify('/sites', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(siteName ? { name: siteName } : {})
      });
      siteId = site.id;
    }
    global.netlifySiteId = siteId;

    // 6. Deploy the zip
    console.log('[deploy-netlify] Deploying to site', siteId);
    let deploy = await netlify(`/sites/${siteId}/deploys`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: zipBuffer
    });

    // 7. Poll until the deploy is live (Netlify processes the upload async)
    const deployId = deploy.id;
    for (let i = 0; i < 30 && deploy.state !== 'ready'; i++) {
      if (deploy.state === 'error') break;
      await new Promise((r) => setTimeout(r, 2000));
      deploy = await netlify(`/sites/${siteId}/deploys/${deployId}`, token);
    }

    if (deploy.state === 'error') {
      return NextResponse.json(
        { success: false, error: `Netlify deploy failed: ${deploy.error_message || 'unknown error'}` },
        { status: 500 }
      );
    }

    const url = deploy.ssl_url || deploy.deploy_ssl_url || deploy.url;
    return NextResponse.json({
      success: true,
      url,
      siteId,
      deployId,
      state: deploy.state,
      adminUrl: deploy.admin_url,
      message: deploy.state === 'ready'
        ? 'Deployed to Netlify'
        : 'Deploy uploaded to Netlify (still processing)'
    });
  } catch (error) {
    console.error('[deploy-netlify] Error:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
