'use client';

import { useEffect, useState } from 'react';

interface Props {
  /** When the data on screen was last fetched, in epoch ms. Null until mounted. */
  fetchedAt: number | null;
  state: 'idle' | 'refreshing' | 'error';
  onRefresh: () => void;
}

/** A finger rather than a mouse: no hover to speak of, or an imprecise pointer. */
const TOUCH_QUERY = '(hover: none), (pointer: coarse)';

/**
 * Tracks the pointer the page is being used with. Starts false so the server
 * and the first client render agree, then settles after mount — and follows a
 * change, such as a tablet docking to a keyboard and trackpad.
 */
function useTouchLike(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(TOUCH_QUERY);
    const update = () => setTouch(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return touch;
}

/**
 * 9/17/26, 10:10 AM in the viewer's own timezone. The narrow no-break space
 * newer ICU puts before AM/PM becomes an ordinary no-break space, which every
 * font has and which still keeps "10:10 AM" together on one line.
 */
function formatStamp(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(ms)
    .replace(/ /g, ' ');
}

/**
 * "Last updated 9/17/26, 10:10 AM · Click to refresh". The page does not fetch
 * on its own, so this says how old the group's answers are and is the one way
 * to get newer ones without reloading.
 *
 * Stays enabled while a fetch is in flight — a button that turns disabled
 * under keyboard focus drops that focus — and simply ignores the extra press.
 */
export default function RefreshButton({ fetchedAt, state, onRefresh }: Props) {
  const touch = useTouchLike();
  const verb = touch ? 'Tap' : 'Click';
  const refreshing = state === 'refreshing';

  // Announced once a refresh has actually been asked for, not on first paint.
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (refreshing) setAsked(true);
  }, [refreshing]);

  const stamp = fetchedAt === null ? null : formatStamp(fetchedAt);

  const announcement = refreshing
    ? 'Refreshing group availability…'
    : state === 'error'
      ? 'Could not refresh group availability.'
      : asked && stamp
        ? `Group availability updated ${stamp}.`
        : '';

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!refreshing) onRefresh();
        }}
        aria-disabled={refreshing}
        className={[
          // A full finger-height target on a phone, pulled back into the line
          // by the negative margins; compact again once a pointer is aiming.
          '-my-2.5 inline-flex min-h-11 max-w-full items-center gap-1.5 py-2.5 text-left text-[0.75rem] leading-snug transition-colors sm:my-0 sm:min-h-0 sm:py-0.5',
          state === 'error' ? 'text-danger' : 'text-muted hover:text-ink',
          refreshing ? 'cursor-progress' : 'cursor-pointer',
        ].join(' ')}
      >
        <svg
          viewBox="0 0 16 16"
          className={`size-3.5 shrink-0 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" />
          <path d="M13.5 2.5v3h-3" />
        </svg>
        <span className="min-w-0">
          {refreshing ? (
            'Refreshing…'
          ) : state === 'error' ? (
            <>
              Couldn’t refresh ·{' '}
              <span className="underline underline-offset-2">{verb} to try again</span>
            </>
          ) : (
            <>
              {stamp ? (
                <>
                  Last updated <span className="num whitespace-nowrap">{stamp}</span> ·{' '}
                </>
              ) : null}
              <span className="underline underline-offset-2">{verb} to refresh</span>
            </>
          )}
        </span>
      </button>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </>
  );
}
