import { getUser } from '@/lib/supabase/server';
import { ensureProfileAndOrg } from '@/lib/db/repos';

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

// Returns the authenticated user + their primary org, provisioning both if needed.
// Throws UnauthorizedError if there is no session.
export async function requireOrg() {
  const user = await getUser();
  if (!user) throw new UnauthorizedError();
  const orgId = await ensureProfileAndOrg(user.id, user.email);
  return { user, orgId };
}
