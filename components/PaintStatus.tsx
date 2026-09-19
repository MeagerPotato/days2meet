'use client';

import { createPortal } from 'react-dom';

interface Props {
  adding: boolean;
  count: number;
  /** Singular; pluralised here. */
  unit: string;
}

/**
 * The pill a touch paint shows while it is live. A finger covers the cells it
 * is painting, and iOS cannot vibrate, so this says out loud that the hold
 * worked and which way the paint is going — marking or clearing. Pinned to the
 * top of the screen, clear of the hand, and invisible to the pointer so it
 * never becomes the element under the finger.
 *
 * Portalled to the body: a grid is a size container on phones, and `fixed`
 * must mean the screen, not whatever box happens to contain the grid. Only
 * ever mounted mid-paint, so there is no server render to match.
 */
export default function PaintStatus({ adding, count, unit }: Props) {
  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-40 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-[0.8125rem] font-medium text-paper shadow-[0_6px_24px_rgba(20,22,26,0.2)]"
    >
      {adding ? 'Marking' : 'Clearing'} <span className="num">{count}</span> {unit}
      {count === 1 ? '' : 's'}
      <span className="text-paper/70"> · lift to finish</span>
    </div>,
    document.body,
  );
}
