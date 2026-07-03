import { and, desc, eq } from 'drizzle-orm';
import { db } from './index';
import {
  orgs, orgMembers, profiles, projects, projectVersions, messages, tenantDatabases, tenantAuth, tenantAi,
  type NewProject,
} from './schema';

// -----------------------------------------------------------------------------
// User / tenant provisioning
// -----------------------------------------------------------------------------

// Ensure a signed-in user has a profile row and a personal org. Idempotent.
// Called on entry to any authenticated flow. Returns the user's primary orgId.
export async function ensureProfileAndOrg(userId: string, email?: string | null): Promise<string> {
  await db.insert(profiles)
    .values({ id: userId, email: email ?? null })
    .onConflictDoNothing();

  const membership = await db.query.orgMembers.findFirst({
    where: eq(orgMembers.userId, userId),
  });
  if (membership) return membership.orgId;

  // No org yet — create a personal one.
  const [org] = await db.insert(orgs)
    .values({ name: email ? `${email.split('@')[0]}'s workspace` : 'Workspace' })
    .returning();

  await db.insert(orgMembers).values({ orgId: org.id, userId, role: 'owner' });
  return org.id;
}

export async function getUserOrgId(userId: string): Promise<string | null> {
  const membership = await db.query.orgMembers.findFirst({
    where: eq(orgMembers.userId, userId),
  });
  return membership?.orgId ?? null;
}

// -----------------------------------------------------------------------------
// Projects
// -----------------------------------------------------------------------------

export async function createProject(orgId: string, data: Partial<NewProject> & { name: string }) {
  const [project] = await db.insert(projects)
    .values({ orgId, name: data.name, sourceUrl: data.sourceUrl, model: data.model, framework: data.framework })
    .returning();
  return project;
}

export async function listProjects(orgId: string) {
  return db.select().from(projects)
    .where(eq(projects.orgId, orgId))
    .orderBy(desc(projects.updatedAt));
}

// Fetch a project but only if it belongs to the given org (tenant isolation).
export async function getProject(orgId: string, projectId: string) {
  return db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)),
  });
}

export async function updateProject(orgId: string, projectId: string, patch: Partial<NewProject>) {
  const [updated] = await db.update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .returning();
  return updated;
}

// -----------------------------------------------------------------------------
// Versions (code snapshots) & chat
// -----------------------------------------------------------------------------

export async function saveVersion(projectId: string, files: Record<string, string>, label?: string) {
  const [version] = await db.insert(projectVersions)
    .values({ projectId, files, label })
    .returning();
  await db.update(projects)
    .set({ currentVersionId: version.id, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  return version;
}

export async function getLatestVersion(projectId: string) {
  return db.query.projectVersions.findFirst({
    where: eq(projectVersions.projectId, projectId),
    orderBy: desc(projectVersions.createdAt),
  });
}

export async function appendMessage(projectId: string, role: string, content: string, seq: number) {
  const [msg] = await db.insert(messages)
    .values({ projectId, role, content, seq })
    .returning();
  return msg;
}

// Replace the full chat history for a project (simplest consistent sync from the client).
export async function replaceMessages(projectId: string, items: { role: string; content: string }[]) {
  await db.delete(messages).where(eq(messages.projectId, projectId));
  if (items.length === 0) return;
  await db.insert(messages).values(
    items.map((m, i) => ({ projectId, role: m.role, content: m.content, seq: i }))
  );
}

export async function getMessages(projectId: string) {
  return db.select().from(messages)
    .where(eq(messages.projectId, projectId))
    .orderBy(messages.seq);
}

// -----------------------------------------------------------------------------
// Per-project databases (Phase 2)
// -----------------------------------------------------------------------------

export async function getProjectDatabase(projectId: string) {
  return db.query.tenantDatabases.findFirst({
    where: eq(tenantDatabases.projectId, projectId),
  });
}

export async function upsertProjectDatabase(
  projectId: string,
  data: { provider?: string; externalRef?: string; encryptedCredentials?: string; status?: string }
) {
  const existing = await getProjectDatabase(projectId);
  if (existing) {
    const [row] = await db.update(tenantDatabases)
      .set(data)
      .where(eq(tenantDatabases.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db.insert(tenantDatabases)
    .values({ projectId, provider: data.provider ?? 'supabase', ...data })
    .returning();
  return row;
}

export async function deleteProjectDatabase(projectId: string) {
  await db.delete(tenantDatabases).where(eq(tenantDatabases.projectId, projectId));
}

// -----------------------------------------------------------------------------
// Per-project auth (Zitadel org) — isolated user pool per project
// -----------------------------------------------------------------------------

export async function getProjectAuth(projectId: string) {
  return db.query.tenantAuth.findFirst({
    where: eq(tenantAuth.projectId, projectId),
  });
}

export async function upsertProjectAuth(
  projectId: string,
  data: {
    provider?: string;
    orgId?: string;
    clientId?: string;
    issuer?: string;
    allowedOrigins?: string[];
    encryptedCredentials?: string;
    status?: string;
  }
) {
  const existing = await getProjectAuth(projectId);
  if (existing) {
    const [row] = await db.update(tenantAuth)
      .set(data)
      .where(eq(tenantAuth.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db.insert(tenantAuth)
    .values({ projectId, provider: data.provider ?? 'zitadel', ...data })
    .returning();
  return row;
}

export async function deleteProjectAuth(projectId: string) {
  await db.delete(tenantAuth).where(eq(tenantAuth.projectId, projectId));
}

// -----------------------------------------------------------------------------
// Per-project AI (Etlaq AI proxy token)
// -----------------------------------------------------------------------------

export async function getProjectAi(projectId: string) {
  return db.query.tenantAi.findFirst({
    where: eq(tenantAi.projectId, projectId),
  });
}

// Used by the public AI proxy to authenticate a per-project token (looked up by
// its sha256 hash — the raw token is never stored in a queryable column).
export async function getProjectAiByTokenHash(tokenHash: string) {
  return db.query.tenantAi.findFirst({
    where: eq(tenantAi.tokenHash, tokenHash),
  });
}

export async function upsertProjectAi(
  projectId: string,
  data: { provider?: string; model?: string; tokenHash?: string; encryptedCredentials?: string; status?: string }
) {
  const existing = await getProjectAi(projectId);
  if (existing) {
    const [row] = await db.update(tenantAi)
      .set(data)
      .where(eq(tenantAi.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db.insert(tenantAi)
    .values({ projectId, provider: data.provider ?? 'etlaq-gateway', ...data })
    .returning();
  return row;
}

export async function deleteProjectAi(projectId: string) {
  await db.delete(tenantAi).where(eq(tenantAi.projectId, projectId));
}
