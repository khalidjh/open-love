import { and, desc, eq } from 'drizzle-orm';
import { db } from './index';
import {
  orgs, orgMembers, profiles, projects, projectVersions, messages,
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
    .values({ orgId, name: data.name, sourceUrl: data.sourceUrl, model: data.model })
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

export async function getMessages(projectId: string) {
  return db.select().from(messages)
    .where(eq(messages.projectId, projectId))
    .orderBy(messages.seq);
}
