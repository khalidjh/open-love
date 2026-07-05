import { NextRequest, NextResponse } from 'next/server';
import { recordAppVisit } from '@/lib/db/repos';

// PUBLIC visitor-analytics collector. Called cross-origin from DEPLOYED apps via
// the injected beacon (navigator.sendBeacon → POST, or an Image() pixel → GET).
// It must never break the host page: any bad input still returns 204, and errors
// are swallowed in recordAppVisit. Input is untrusted.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

function noContent() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function OPTIONS() {
  return noContent();
}

async function collect(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams;

    // Query params (Image pixel + sendBeacon URL) take precedence; fall back to a
    // JSON body if one was posted.
    let projectId = q.get('p') || '';
    let visitorId = q.get('v') || '';
    let path = q.get('path') || '';
    let referrer = '';

    if (!projectId && request.method === 'POST') {
      const body = await request.json().catch(() => ({} as any));
      projectId = body?.p || body?.projectId || '';
      visitorId = body?.v || body?.visitorId || '';
      path = body?.path || '';
      referrer = body?.referrer || '';
    }
    if (!referrer) referrer = request.headers.get('referer') || '';

    if (projectId) {
      await recordAppVisit({
        projectId,
        visitorId: visitorId || null,
        path: path ? path.slice(0, 512) : null,
        referrer: referrer ? referrer.slice(0, 512) : null,
      });
    }
  } catch {
    // Never surface errors to the deployed app.
  }
  return noContent();
}

export async function GET(request: NextRequest) {
  return collect(request);
}

export async function POST(request: NextRequest) {
  return collect(request);
}
