import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

/**
 * Next 16 renamed middleware.ts to proxy.ts and the export to `proxy`.
 * middleware.ts still works but is deprecated — do not rename this back.
 *
 * Lives under src/, not the repo root: this project's `app/` is at
 * `src/app`, and per node_modules/next/dist/docs/.../file-conventions/proxy.md
 * proxy.ts must sit "in the project root, or inside `src` if applicable, so
 * that it is located at the same level as `pages` or `app`." A root-level
 * proxy.ts here is silently never invoked — no error, no build warning,
 * just wide-open routes. Confirmed via `npm run build`: only the src/
 * location produces a "ƒ Proxy (Middleware)" line in the route table.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
