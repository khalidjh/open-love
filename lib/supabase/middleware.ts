import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Refreshes the Supabase auth session on every request and (optionally) guards routes.
export async function updateSession(request: NextRequest) {
  // Etlaq Kids is a no-login playground — skip the Supabase session refresh
  // entirely for it, so a kid never triggers an auth network call (and the
  // page still works if Supabase is unreachable/unconfigured).
  const p = request.nextUrl.pathname;
  if (p.startsWith('/kids') || p.startsWith('/api/kids')) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: refreshes the session token.
  const { data: { user } } = await supabase.auth.getUser();

  // Route guard: require auth for the app, allow auth pages and public assets.
  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith('/login') ||
    path.startsWith('/auth') ||
    // Generated tenant apps call the AI proxy with a per-project bearer token,
    // not a Supabase session — it authenticates itself and must stay public.
    path.startsWith('/api/ai/proxy') ||
    // The visitor-analytics beacon is fired cross-origin from DEPLOYED apps with
    // no Supabase session; it validates its own input and must stay public (a
    // redirect here would silently drop every page-view).
    path.startsWith('/api/analytics/collect') ||
    path === '/' ||
    path === '/robots.txt' ||
    path === '/sitemap.xml' ||
    path === '/manifest.webmanifest';

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return response;
}
