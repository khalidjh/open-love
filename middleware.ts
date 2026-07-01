import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Refreshes the Supabase session and guards non-public routes.
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
