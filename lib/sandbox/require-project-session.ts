import { NextResponse } from 'next/server';
import { requireOrg, UnauthorizedError } from '@/lib/auth';
import { getProject } from '@/lib/db/repos';
import { getOrCreateSession, type SandboxSession } from './session-store';
import type { Project } from '@/lib/db/schema';

// Thrown when the request omits a projectId.
export class BadRequestError extends Error {
  constructor(message = 'projectId is required') {
    super(message);
    this.name = 'BadRequestError';
  }
}

// Thrown when the project doesn't exist OR isn't owned by the caller's org.
// Returned as 404 (not 403) so we don't confirm existence of other tenants' ids.
export class ProjectNotFoundError extends Error {
  constructor(message = 'Project not found') {
    super(message);
    this.name = 'ProjectNotFoundError';
  }
}

export interface ProjectSession {
  orgId: string;
  project: Project;
  session: SandboxSession;
}

// Resolve the authenticated caller's sandbox session for a given project.
//
// This is the tenant-isolation boundary for every sandbox operation:
//   1. requireOrg()  -> 401 if there is no valid session,
//   2. getProject(orgId, projectId) -> 404 unless this org owns the project,
//   3. return the per-project in-memory session (created on first use).
// Only after this may a route touch a sandbox — and only that project's sandbox.
export async function requireProjectSession(
  projectId: string | undefined | null,
): Promise<ProjectSession> {
  if (!projectId) throw new BadRequestError();
  const { orgId } = await requireOrg();
  const project = await getProject(orgId, projectId);
  if (!project) throw new ProjectNotFoundError();
  return { orgId, project, session: getOrCreateSession(projectId) };
}

// Lightweight auth gate for legacy/secondary routes that aren't fully ported to
// per-project sessions yet: rejects unauthenticated callers with 401, otherwise
// returns null so the handler proceeds. Usage:
//   const denied = await guardAuth(); if (denied) return denied;
export async function guardAuth(): Promise<NextResponse | null> {
  try {
    await requireOrg();
    return null;
  } catch (error) {
    return toErrorResponse(error);
  }
}

// Map a thrown auth/ownership error to the right HTTP response so routes can just
// `try { ... } catch (e) { return toErrorResponse(e); }`.
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (error instanceof BadRequestError) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
  if (error instanceof ProjectNotFoundError) {
    return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
  }
  console.error('[requireProjectSession] unexpected error:', error);
  return NextResponse.json(
    { success: false, error: (error as Error)?.message ?? 'Internal error' },
    { status: 500 },
  );
}
