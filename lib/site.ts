/**
 * Where days2meet lives. No server imports, so middleware and client
 * components can both read it.
 */
export const CANONICAL_HOST = 'days2meet.allenkh.com';
export const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;

/** The launch address. Its links keep working — it forwards here — but it is never handed out again. */
export const LEGACY_HOST = 'days2meet.vercel.app';

/**
 * The origin to put in a link someone is about to share. On the launch address
 * that is the canonical one, so old links stop spreading; everywhere else
 * (previews, localhost) it is the page's own origin, so a copied link works
 * where it was copied.
 */
export function shareOrigin(): string {
  if (typeof window === 'undefined') return CANONICAL_ORIGIN;
  return window.location.hostname === LEGACY_HOST ? CANONICAL_ORIGIN : window.location.origin;
}
