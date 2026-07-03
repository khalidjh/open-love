// Pull the project's KSA-Supabase + auth creds and split them by exposure.
// NEXT_PUBLIC_* ships to the browser (safe: URL + anon key + OIDC client id).
// Shared by every full-stack deploy target (KSA runtime, Vercel fallback).

import { getProjectDatabase, getProjectAuth } from '@/lib/db/repos';
import { decrypt } from '@/lib/crypto';

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

  // TODO(phase2): server-only secrets go in secretEnv. Do NOT ship the shared
  // SUPABASE_SERVICE_ROLE_KEY to a tenant app — mint a per-project scoped key first.

  return { publicEnv, secretEnv };
}
