'use client';

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';

/**
 * Vercel Web Analytics, cookieless and served from our own origin, so the CSP
 * needs nothing new. An event link is a private capability, so the slug is
 * rewritten to its route before a page view leaves the browser: the dashboard
 * can count visits to event pages without ever holding a working link.
 */
function redact(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  url.pathname = url.pathname.replace(/^\/e\/[^/]+/, '/e/[slug]');
  url.search = '';
  url.hash = '';
  return { ...event, url: url.toString() };
}

export default function SiteAnalytics() {
  // In development the package loads a debug script from Vercel's CDN, which
  // the CSP rightly refuses. There is nothing to measure locally anyway.
  if (process.env.NODE_ENV !== 'production') return null;
  return <Analytics beforeSend={redact} />;
}
