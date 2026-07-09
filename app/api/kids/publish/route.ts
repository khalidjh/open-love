import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { resolveSlug, APPS_DOMAIN, APPS_DIR, waitForTls } from '@/lib/deploy/ksa-shared';

// Publish a kid's single-file HTML app to the KSA static host with NO sandbox,
// NO build, and NO auth. The wildcard Caddy vhost already serves
// *.APPS_DOMAIN from <slug>/public, so we just drop index.html in place.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let creationId = '';
  let html = '';
  let siteName: string | undefined;
  try {
    const body = await request.json();
    creationId = String(body?.creationId || '');
    html = String(body?.html || '');
    siteName = body?.siteName ? String(body.siteName) : undefined;
  } catch {
    return NextResponse.json({ success: false, reason: 'bad-request' }, { status: 400 });
  }

  if (!creationId || !html.trim()) {
    return NextResponse.json({ success: false, reason: 'missing-fields' }, { status: 400 });
  }

  // Only the KSA runtime host has the apps dir + Caddy mounted. Detect it by
  // checking the apps dir actually exists — not by an env var, since the deploy
  // relies on APPS_DIR's default (/opt/etlaq-apps) rather than KSA_APPS_DIR
  // being set. Everywhere else (local dev, previews) we can't publish, so we say
  // so clearly and the UI keeps the live preview + offers a download.
  let hostReady = false;
  try {
    hostReady = (await fs.stat(APPS_DIR)).isDirectory();
  } catch {
    hostReady = false;
  }
  if (!hostReady) {
    return NextResponse.json({ success: false, reason: 'not-configured' }, { status: 200 });
  }

  try {
    const slug = resolveSlug(creationId, siteName || 'app');
    const dir = path.join(APPS_DIR, slug, 'public');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'index.html');
    await fs.writeFile(file, html, 'utf8');
    // World-readable so the Caddy file server can serve it.
    await fs.chmod(file, 0o644).catch(() => {});

    const url = `https://${slug}.${APPS_DOMAIN}`;
    await waitForTls(url);
    return NextResponse.json({ success: true, url, slug });
  } catch (err) {
    console.error('[kids/publish] error:', err);
    return NextResponse.json({ success: false, reason: 'publish-failed' }, { status: 500 });
  }
}
