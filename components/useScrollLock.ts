'use client';

import { useEffect, useRef } from 'react';

interface Saved {
  position: string;
  top: string;
  width: string;
  overflow: string;
  scrollY: number;
}

/**
 * Pins the page behind a modal, so a swipe on the backdrop cannot scroll the
 * page out from under the dialog.
 *
 * The grids no longer use this. Painting by touch is a press-and-hold, which
 * only engages once the finger — and so any momentum under it — has been still
 * for a moment, and from then on usePaintGesture cancels the scroll itself.
 */
export function useScrollLock(locked: boolean): void {
  const saved = useRef<Saved | null>(null);

  useEffect(() => {
    if (!locked) return;

    const body = document.body;

    // Locking twice would record the locked styles as the ones to put back.
    if (!saved.current) {
      const scrollY = window.scrollY;
      saved.current = {
        position: body.style.position,
        top: body.style.top,
        width: body.style.width,
        overflow: body.style.overflow,
        scrollY,
      };
      // iOS Safari scrolls straight through `overflow: hidden`; only taking the
      // body out of flow actually holds it still.
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.width = '100%';
      body.style.overflow = 'hidden';
    }

    // Unlocking from cleanup rather than a `locked === false` branch is what
    // makes unmounting mid-drag safe: a stuck lock freezes the whole app.
    return () => {
      const previous = saved.current;
      if (!previous) return;
      saved.current = null;

      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;

      // A plain scrollTo would animate under an ancestor `scroll-behavior:
      // smooth` and drift the page after the drag has already committed.
      window.scrollTo({ top: previous.scrollY, left: 0, behavior: 'instant' });
    };
  }, [locked]);
}
