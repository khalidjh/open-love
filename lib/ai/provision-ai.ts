// Provision per-project AI: a revocable token the generated app uses to reach the
// Etlaq AI proxy (which forwards to the Vercel AI Gateway). The app never holds
// the real model key — only this token. Mirrors lib/auth/provision-auth.ts.

import { randomBytes, createHash } from 'crypto';

// Fallback model slug when nothing else matches. Fast + cheap; a Vercel AI
// Gateway id. Prefer defaultModelForEnv()/servableModel() over this constant so
// the proxy never picks a model whose provider key isn't actually configured.
export const DEFAULT_AI_MODEL = 'anthropic/claude-haiku-4-5-20251001';

export interface ProvisionedAi {
  token: string; // raw token — only available at mint time; stored encrypted
  model: string;
}

// `.env.example` ships placeholder values like `your_anthropic_api_key`; a raw
// truthiness check treats those as "configured" and the proxy then 401s upstream
// on a fake key. Reject empty and obvious placeholder values so we only route to
// a provider whose key is real.
function realKey(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (!t || /^your_/i.test(t) || /^(changeme|placeholder|xxx+)$/i.test(t)) return undefined;
  return t;
}

// Provider preference order + the default model to serve for each. Mirrors the
// house codegen default (GLM via Z.AI) so the proxy serves the same model the
// platform is already known to reach. The AI Gateway (when present) can route to
// any provider, so it wins and keeps the cheap Anthropic default.
const PROVIDER_DEFAULTS: Array<{ env: string; model: string }> = [
  { env: 'AI_GATEWAY_API_KEY', model: 'anthropic/claude-haiku-4-5-20251001' },
  { env: 'ZAI_API_KEY', model: 'zai/glm-4.6' },
  { env: 'ANTHROPIC_API_KEY', model: 'anthropic/claude-haiku-4-5-20251001' },
  { env: 'OPENAI_API_KEY', model: 'openai/gpt-4o-mini' },
  { env: 'GROQ_API_KEY', model: 'moonshotai/kimi-k2-instruct-0905' },
  { env: 'GEMINI_API_KEY', model: 'google/gemini-2.0-flash' },
];

// Which provider prefix a `provider/model` slug routes to in the proxy.
function providerEnvForSlug(slug: string): string {
  if (slug.startsWith('anthropic/')) return 'ANTHROPIC_API_KEY';
  if (slug.startsWith('openai/')) return 'OPENAI_API_KEY';
  if (slug.startsWith('google/')) return 'GEMINI_API_KEY';
  if (slug.startsWith('zai/')) return 'ZAI_API_KEY';
  return 'GROQ_API_KEY'; // bare id / groq fallback
}

// AI is available whenever the platform has a usable model backend — the Vercel
// AI Gateway, or any direct provider key the proxy can route to.
export function isEtlaqAiConfigured(): boolean {
  return PROVIDER_DEFAULTS.some(({ env }) => realKey(process.env[env]));
}

// Pick a default model whose provider key is actually configured, so the proxy
// can serve a completion instead of 401-ing on a placeholder default. Falls back
// to DEFAULT_AI_MODEL when nothing is configured (callers gate on isEtlaqAiConfigured).
export function defaultModelForEnv(): string {
  const hit = PROVIDER_DEFAULTS.find(({ env }) => realKey(process.env[env]));
  return hit?.model || DEFAULT_AI_MODEL;
}

// Return `preferred` only if its provider key is real; otherwise the best
// available default. The AI Gateway can serve any provider, so honour the pin
// as-is when it's set. Keeps already-provisioned projects (whose stored model
// may predate this fix) working instead of failing on a stale slug.
export function servableModel(preferred: string | null | undefined): string {
  if (realKey(process.env.AI_GATEWAY_API_KEY)) return preferred || defaultModelForEnv();
  if (preferred && realKey(process.env[providerEnvForSlug(preferred)])) return preferred;
  return defaultModelForEnv();
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
  return `${etlaqPublicBase()}/api/ai/proxy`;
}

// Public URL of the Etlaq speech-to-text endpoint. A generated voice app posts its
// recorded audio here (through its own server route, using the same per-project AI
// token) and gets back transcribed text. Same reachability requirements as the proxy.
export function etlaqTranscribeUrl(): string {
  return `${etlaqPublicBase()}/api/ai/transcribe`;
}

function etlaqPublicBase(): string {
  const base =
    process.env.ETLAQ_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return base.replace(/\/$/, '');
}

// Speech-to-text is available when a Whisper-capable provider key is real. We use
// Groq's whisper-large-v3 first (fast + cheap), falling back to OpenAI whisper-1.
// Returns the provider to use, or null when neither key is configured.
export function transcribeProvider(): 'groq' | 'openai' | null {
  if (realKey(process.env.GROQ_API_KEY)) return 'groq';
  if (realKey(process.env.OPENAI_API_KEY)) return 'openai';
  return null;
}

// Mint a fresh per-project token. Idempotency (reuse an already-issued token) is
// handled by the route, which can decrypt the stored token — a hash can't be
// reversed, so re-minting here would orphan already-deployed apps.
export async function provisionProjectAi(): Promise<ProvisionedAi> {
  if (!isEtlaqAiConfigured()) {
    throw new Error('Etlaq AI is not configured. Set AI_GATEWAY_API_KEY to enable per-project AI.');
  }
  const token = `etlaq_ai_${randomBytes(32).toString('hex')}`;
  return { token, model: defaultModelForEnv() };
}
