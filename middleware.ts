import { NextResponse, type NextRequest } from 'next/server';

import { CANONICAL_ORIGIN, LEGACY_HOST } from '@/lib/site';

/**
 * Moves visitors from the launch address (days2meet.vercel.app) to the
 * canonical one without signing anybody out.
 *
 * Session cookies are host-only, so a browser signed in on the old address is
 * a stranger on the new one. Anyone already holding a cookie for the event
 * they are opening therefore stays where they are until it lapses (at most 30
 * days, see lib/session.ts); everyone else is sent across. After that window a
 * plain permanent redirect in the Vercel domain settings replaces this file.
 *
 * Off unless LEGACY_HOST_REDIRECT=1, so the code can ship before the switch is
 * thrown, and unthrown without a code change.
 */

// Must match cookieName/adminCookieName in lib/session.ts, which imports
// node:crypto and so cannot be loaded here. Slugs are nanoid(10).
const EVENT_PAGE = /^\/e\/([A-Za-z0-9_-]+)(?:\/edit)?\/?$/;

export function middleware(request: NextRequest) {
  if (process.env.LEGACY_HOST_REDIRECT !== '1') return NextResponse.next();

  const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase();
  if (host !== LEGACY_HOST) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const event = EVENT_PAGE.exec(pathname);
  if (event && (request.cookies.has(`w2m_${event[1]}`) || request.cookies.has(`w2m_admin_${event[1]}`))) {
    return NextResponse.next();
  }

  // 307, not 308, and never cached: a browser keeps a permanent redirect
  // forever, and this one has to stay reversible until the grace period ends.
  const response = NextResponse.redirect(new URL(`${pathname}${search}`, CANONICAL_ORIGIN), 307);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  // /api stays on the old host: a cross-origin redirect of a fetch fails CORS,
  // and a tab left open there would lose the marks it was saving. /_next and
  // /_vercel serve the assets and analytics of pages still in their grace
  // period. The host condition means the canonical host never runs this.
  matcher: [
    {
      source: '/((?!api/|_next/|_vercel/).*)',
      has: [{ type: 'host', value: 'days2meet\\.vercel\\.app' }],
    },
  ],
};
