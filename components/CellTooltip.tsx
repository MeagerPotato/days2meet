'use client';

import { useLayoutEffect, useState } from 'react';

export interface TooltipData {
  /** The slot it describes, so a second tap on the same cell can close it. */
  slot: number;
  heading: string;
  count: number;
  total: number;
  available: string[];
  unavailable: string[];
  anchor: { x: number; y: number };
  pinned: boolean;
}

/** Past this many names a list flows into two columns, so a big group still fits a phone screen. */
const TWO_COLUMN_AFTER = 8;

/**
 * Fixed-position so it escapes the grid's scroll container, and clamped to the
 * viewport so it stays readable at 360px. On touch it is pinned by a tap and
 * sits above the finger, which would otherwise cover it.
 */
export default function CellTooltip({ data }: { data: TooltipData | null }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Layout effect, so the first frame is already in place rather than at 0,0.
  useLayoutEffect(() => {
    if (!data || !element) {
      setPosition(null);
      return;
    }
    const box = element.getBoundingClientRect();
    const margin = 8;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const left = Math.min(
      Math.max(margin, data.anchor.x - box.width / 2),
      window.innerWidth - box.width - margin,
    );
    const above = data.anchor.y - box.height - 10;
    const below = data.anchor.y + 22;
    const preferred = above > margin ? above : below;
    // A long roster can be taller than the room on either side of the cell;
    // then it simply stays on screen and overlaps the grid.
    const top = Math.max(margin, Math.min(preferred, viewportHeight - box.height - margin));
    setPosition({ left, top });
  }, [data, element]);

  if (!data) return null;

  const columns = (names: string[]) => (names.length > TWO_COLUMN_AFTER ? 'columns-2 gap-x-3' : '');

  return (
    <div
      ref={setElement}
      role="tooltip"
      className="pointer-events-none fixed z-50 max-h-[calc(100dvh-1rem)] max-w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-line bg-surface px-3 py-2 text-[0.8125rem] shadow-[0_6px_24px_rgba(20,22,26,0.12)]"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <p className="num font-semibold">
        {data.count}/{data.total} available
      </p>
      <p className="mt-0.5 text-[0.75rem] text-muted">{data.heading}</p>

      {data.available.length > 0 ? (
        <ul className={`mt-1.5 space-y-0.5 ${columns(data.available)}`}>
          {data.available.map((name) => (
            <li key={name} className="truncate">
              {name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-muted">No one</p>
      )}

      {data.unavailable.length > 0 ? (
        <>
          <div className="my-1.5 border-t border-line" />
          <ul className={`space-y-0.5 text-muted ${columns(data.unavailable)}`}>
            {data.unavailable.map((name) => (
              <li key={name} className="truncate line-through decoration-[0.5px]">
                {name}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
