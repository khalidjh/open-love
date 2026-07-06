import { getSession } from './session-store';
import { getProjectDatabase, getProjectAuth, getProjectAi } from '@/lib/db/repos';
import { decrypt } from '@/lib/crypto';
import { etlaqAiProxyUrl, etlaqTranscribeUrl } from '@/lib/ai/provision-ai';
import { getTemplate, type Framework } from '@/lib/templates';

// Compose the COMPLETE .env for a project's live sandbox from every provisioned
// capability (database, auth, AI) and write it in one shot.
//
// Why this exists: each capability route writes `.env` via provider.writeFile,
// which OVERWRITES the file. If they each wrote only their own vars, provisioning
// one capability would clobber another's (enable AI after a DB, lose the DB URL).
// Building the full env from the DB records every time keeps all of them present.
//
// Returns false if the project has no live sandbox to write into.
export async function writeSandboxEnv(projectId: string, framework: Framework): Promise<boolean> {
  const provider = getSession(projectId)?.provider;
  if (!provider) return false;

  const t = getTemplate(framework).env;
  const lines: string[] = [];

  // Database (Supabase) — public URL + anon key + per-project schema.
  const dbRec = await getProjectDatabase(projectId);
  if (dbRec?.encryptedCredentials) {
    try {
      const { url, anonKey, schema } = JSON.parse(decrypt(dbRec.encryptedCredentials));
      if (url) lines.push(`${t.supabaseUrl}=${url}`);
      if (anonKey) lines.push(`${t.supabaseAnonKey}=${anonKey}`);
      if (schema) lines.push(`${t.supabaseSchema}=${schema}`);
    } catch { /* ignore malformed creds */ }
  }

  // Auth (Zitadel OIDC) — public issuer + client id.
  const authRec = await getProjectAuth(projectId);
  if (authRec?.issuer) lines.push(`${t.authIssuer}=${authRec.issuer}`);
  if (authRec?.clientId) lines.push(`${t.authClientId}=${authRec.clientId}`);

  // AI — server-only proxy URL + per-project token (decrypted from storage).
  const aiRec = await getProjectAi(projectId);
  if (aiRec?.status === 'ready' && aiRec.encryptedCredentials) {
    try {
      const token = decrypt(aiRec.encryptedCredentials);
      lines.push(`${t.aiProxyUrl}=${etlaqAiProxyUrl()}`);
      lines.push(`${t.aiProxyKey}=${token}`);
      // Speech-to-text shares the AI token; expose its endpoint for voice apps.
      lines.push(`${t.transcribeUrl}=${etlaqTranscribeUrl()}`);
    } catch { /* ignore malformed token */ }
  }

  await provider.writeFile('.env', lines.join('\n') + '\n');
  return true;
}
