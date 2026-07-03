// Provision per-project AI: a revocable token the generated app uses to reach the
// Etlaq AI proxy (which forwards to the Vercel AI Gateway). The app never holds
// the real model key — only this token. Mirrors lib/auth/provision-auth.ts.

import { randomBytes, createHash } from 'crypto';

// Default model the proxy serves when a project hasn't pinned its own. Fast +
// cheap, good enough for typical chatbots. Slug is a Vercel AI Gateway model id.
export const DEFAULT_AI_MODEL = 'anthropic/claude-haiku-4-5-20251001';

export interface ProvisionedAi {
  token: string; // raw token — only available at mint time; stored encrypted
  model: string;
}

// AI is available whenever the platform has a usable model backend — the Vercel
// AI Gateway, or any direct provider key the proxy can route to. (A project can
// pin any of these via its `model` column; the default is Claude Haiku.)
export function isEtlaqAiConfigured(): boolean {
  return !!(
    process.env.AI_GATEWAY_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.ZAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.GEMINI_API_KEY
  );
}

// The proxy authenticates a token by its sha256 hash, so we never persist the raw
// token in a queryable column.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Public URL of the Etlaq AI proxy that generated apps call. Must be reachable
// from the E2B sandbox (dev preview) and from KSA containers (prod) — i.e. a real
// public URL in any non-local environment. Single source for both the sandbox
// injector and the deploy env builder.
export function etlaqAiProxyUrl(): string {
  const base =
    process.env.ETLAQ_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/ai/proxy`;
}

// Mint a fresh per-project token. Idempotency (reuse an already-issued token) is
// handled by the route, which can decrypt the stored token — a hash can't be
// reversed, so re-minting here would orphan already-deployed apps.
export async function provisionProjectAi(): Promise<ProvisionedAi> {
  if (!isEtlaqAiConfigured()) {
    throw new Error('Etlaq AI is not configured. Set AI_GATEWAY_API_KEY to enable per-project AI.');
  }
  const token = `etlaq_ai_${randomBytes(32).toString('hex')}`;
  return { token, model: DEFAULT_AI_MODEL };
}
