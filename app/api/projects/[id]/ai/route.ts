import { NextRequest, NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject, getProjectAi, upsertProjectAi, deleteProjectAi } from '@/lib/db/repos';
import {
  provisionProjectAi, isEtlaqAiConfigured, hashToken, DEFAULT_AI_MODEL,
} from '@/lib/ai/provision-ai';
import { encrypt, decrypt } from '@/lib/crypto';
import { writeSandboxEnv } from '@/lib/sandbox/write-sandbox-env';
import { getSession } from '@/lib/sandbox/session-store';
import { type Framework } from '@/lib/templates';

// Inject the composed .env (db + auth + AI) into the live sandbox and restart the
// dev server so the app can read ETLAQ_AI_URL / ETLAQ_AI_KEY from its server route.
// A chatbot talks to its own /api/chat via fetch, so there's no client SDK to install.
async function injectIntoSandbox(projectId: string, framework: Framework) {
  const provider = getSession(projectId)?.provider;
  if (!provider) return;
  try {
    await writeSandboxEnv(projectId, framework);
    if (framework === 'nextjs') await provider.restartNextServer();
    else await provider.restartViteServer();
  } catch (e) {
    console.error('[ai] sandbox injection failed', e);
  }
}

async function requireOwnedProject(id: string) {
  const { orgId } = await requireOrg();
  const project = await getProject(orgId, id);
  return { orgId, project };
}

// GET — current AI status for the project
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { project } = await requireOwnedProject(id);
    if (!project) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const rec = await getProjectAi(id);
    return NextResponse.json({
      success: true,
      configured: isEtlaqAiConfigured(),
      ai: rec ? { status: rec.status, provider: rec.provider, model: rec.model || DEFAULT_AI_MODEL } : null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

// POST — provision per-project AI (idempotent). Reuses an existing token so
// already-deployed apps keep working; only mints a new one on first enable.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { project } = await requireOwnedProject(id);
    if (!project) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    if (!isEtlaqAiConfigured()) {
      return NextResponse.json(
        { success: false, error: 'AI backend not configured (AI_GATEWAY_API_KEY).' },
        { status: 501 }
      );
    }

    await upsertProjectAi(id, { status: 'provisioning' });

    // Idempotent: reuse the already-issued token when present (a hash can't be
    // reversed, so re-minting would orphan deployed apps).
    const existing = await getProjectAi(id);
    let token: string;
    let model: string;
    if (existing?.encryptedCredentials && existing.tokenHash) {
      token = decrypt(existing.encryptedCredentials);
      model = existing.model || DEFAULT_AI_MODEL;
    } else {
      const provisioned = await provisionProjectAi();
      token = provisioned.token;
      model = provisioned.model;
    }

    await upsertProjectAi(id, {
      provider: 'etlaq-gateway',
      model,
      tokenHash: hashToken(token),
      encryptedCredentials: encrypt(token),
      status: 'ready',
    });

    await injectIntoSandbox(id, (project.framework as Framework) || 'vite');

    return NextResponse.json({ success: true, ai: { status: 'ready', model } });
  } catch (error) {
    const { id } = await params;
    try { await upsertProjectAi(id, { status: 'error' }); } catch {}
    if (error instanceof UnauthorizedError) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

// DELETE — revoke the project's AI token
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { project } = await requireOwnedProject(id);
    if (!project) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    await deleteProjectAi(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
