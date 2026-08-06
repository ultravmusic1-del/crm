import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/lib/database.types'

/** Everything else in the app requires a session. */
const PUBLIC_PATHS = ['/login', '/auth/callback', '/auth/confirm']

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          supabaseResponse = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options)
          }
          // headers is Record<string, string>, NOT a Headers instance —
          // verified against @supabase/ssr 0.12.4's own .d.ts. These are the
          // no-store cache directives; without them a CDN or reverse proxy
          // can serve one user's session token to another user.
          for (const [key, value] of Object.entries(headers)) {
            supabaseResponse.headers.set(key, value)
          }
        },
      },
    },
  )

  // ══════════════════════════════════════════════════════════════════════
  // NO CODE BETWEEN createServerClient AND getClaims. Supabase documents
  // this specifically; anything inserted here causes random logouts that
  // are very hard to trace back to this file.
  // ══════════════════════════════════════════════════════════════════════
  const { data } = await supabase.auth.getClaims()
  // ══════════════════════════════════════════════════════════════════════

  const claims = data?.claims
  const { pathname } = request.nextUrl

  if (!claims && !isPublic(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (claims && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Must be the response the client built, cookies and all.
  return supabaseResponse
}
