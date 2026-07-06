// Pull the project's KSA-Supabase + auth creds and split them by exposure.
// NEXT_PUBLIC_* ships to the browser (safe: URL + anon key + OIDC client id).
// Shared by every full-stack deploy target (KSA runtime, Vercel fallback).

import { getProjectDatabase, getProjectAuth, getProjectAi } from '@/lib/db/repos';
import { decrypt } from '@/lib/crypto';
import { etlaqAiProxyUrl, etlaqTranscribeUrl } from '@/lib/ai/provision-ai';

export async function buildEnv(projectId: string) {
  const publicEnv: Record<string, string> = {};
  const secretEnv: Record<string, string> = {};

  const dbRec = await getProjectDatabase(projectId);
  if (dbRec?.encryptedCredentials) {
    try {
      const { url, anonKey, schema } = JSON.parse(decrypt(dbRec.encryptedCredentials));
      if (url) publicEnv.NEXT_PUBLIC_SUPABASE_URL = url;
      if (anonKey) publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
      if (schema) publicEnv.NEXT_PUBLIC_SUPABASE_SCHEMA = schema;
    } catch { /* ignore malformed creds */ }
  }

  const authRec = await getProjectAuth(projectId);
  if (authRec?.issuer) publicEnv.NEXT_PUBLIC_AUTH_ISSUER = authRec.issuer;
  if (authRec?.clientId) publicEnv.NEXT_PUBLIC_AUTH_CLIENT_ID = authRec.clientId;

  // AI: server-only (no NEXT_PUBLIC_ prefix) so the per-project token never
  // reaches the browser — only the app's own server route reads it.
  const aiRec = await getProjectAi(projectId);
  if (aiRec?.status === 'ready' && aiRec.encryptedCredentials) {
    try {
      secretEnv.ETLAQ_AI_KEY = decrypt(aiRec.encryptedCredentials);
      secretEnv.ETLAQ_AI_URL = etlaqAiProxyUrl();
      // Speech-to-text shares the AI token; expose its endpoint for voice apps.
      secretEnv.ETLAQ_TRANSCRIBE_URL = etlaqTranscribeUrl();
    } catch { /* ignore malformed token */ }
  }

  // TODO(phase2): more server-only secrets go in secretEnv. Do NOT ship the shared
  // SUPABASE_SERVICE_ROLE_KEY to a tenant app — mint a per-project scoped key first.

  return { publicEnv, secretEnv };
}
