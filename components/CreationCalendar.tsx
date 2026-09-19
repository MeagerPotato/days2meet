'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { dateRange, formatMonthTitle, formatWeekdayMonthDay, toKey, toUTCms } from '@/lib/dates';
import type { EventMode } from '@/lib/slots';
import { usePaintGesture } from './usePaintGesture';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function monthCells(year: number, month: number): (string | null)[] {
  const lead = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= dayCount; day++) cells.push(toKey(new Date(year, month, day)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function dateOfElement(element: Element | null): string | null {
  return element?.closest<HTMLElement>('[data-date]')?.dataset.date ?? null;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

interface Props {
  mode: EventMode;
  onChange: (dates: string[]) => void;
  /**
   * Seeds the picker when an event already has dates. Read once — this is a
   * starting point to adjust, not a controlled value, so editing here never
   * fights the parent.
   */
  initialDates?: string[];
}

/**
 * Date picker for the create form. Two months at a time.
 *
 * `date_time` mode multi-selects individual dates: click or drag with a mouse;
 * on a phone, tap, or press and hold then drag (a plain swipe scrolls).
 * `date_only` mode picks a start and an end, then lets you punch holes in the
 * range — the fast path for "the whole of winter break, minus the 25th".
 */
export default function CreationCalendar({ mode, onChange, initialDates }: Props) {
  const today = useMemo(() => toKey(new Date()), []);
  const seed = useMemo(() => [...(initialDates ?? [])].sort(), [initialDates]);

  const [view, setView] = useState(() => {
    // Open on the dates the event already covers, not on today, which may be
    // months away from them.
    if (seed.length > 0) {
      return { year: Number(seed[0].slice(0, 4)), month: Number(seed[0].slice(5, 7)) - 1 };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // date_time state
  const [picked, setPicked] = useState<Set<string>>(() => new Set(mode === 'date_time' ? seed : []));
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const paintRef = useRef<{ adding: boolean }>({ adding: true });
  /** The touch anchor, lit while a finger paints. */
  const [anchor, setAnchor] = useState<string | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  // date_only state
  // A saved date list is a span with holes punched in it, which is exactly the
  // shape this mode edits — so the span is its ends, and the holes are whatever
  // the span covers that the event does not.
  const [rangeStart, setRangeStart] = useState<string | null>(
    mode === 'date_only' && seed.length > 0 ? seed[0] : null,
  );
  const [rangeEnd, setRangeEnd] = useState<string | null>(
    mode === 'date_only' && seed.length > 0 ? seed[seed.length - 1] : null,
  );
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(() => {
    if (mode !== 'date_only' || seed.length === 0) return new Set();
    const kept = new Set(seed);
    return new Set(dateRange(seed[0], seed[seed.length - 1]).filter((date) => !kept.has(date)));
  });

  const rangeDates = useMemo(() => {
    if (!rangeStart) return [];
    const end = rangeEnd ?? hoverDate ?? rangeStart;
    return dateRange(
      toUTCms(rangeStart) <= toUTCms(end) ? rangeStart : end,
      toUTCms(rangeStart) <= toUTCms(end) ? end : rangeStart,
    );
  }, [rangeStart, rangeEnd, hoverDate]);

  const committedRange = useMemo(
    () => (rangeStart && rangeEnd ? dateRange(rangeStart, rangeEnd) : []),
    [rangeStart, rangeEnd],
  );

  const selected = useMemo(() => {
    if (mode === 'date_time') return [...picked].sort();
    return committedRange.filter((date) => !excluded.has(date));
  }, [mode, picked, committedRange, excluded]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current(selected);
  }, [selected]);

  /* ---------------------------------------------------------- date_time drag */

  const applyPaint = useCallback((date: string, adding: boolean) => {
    setPicked((previous) => {
      if (adding === previous.has(date)) return previous;
      const next = new Set(previous);
      if (adding) next.add(date);
      else next.delete(date);
      return next;
    });
  }, []);

  // Painting applies as it goes, so there is nothing to commit at the end.
  const paint = usePaintGesture<string>({
    enabled: mode === 'date_time',
    surfaceRef,
    keyOf: dateOfElement,
    onBegin: (date, pointerType) => {
      const adding = !pickedRef.current.has(date);
      paintRef.current = { adding };
      if (pointerType !== 'mouse') setAnchor(date);
      applyPaint(date, adding);
    },
    onExtend: (date) => applyPaint(date, paintRef.current.adding),
    onEnd: () => setAnchor(null),
    onTap: (date) => applyPaint(date, !pickedRef.current.has(date)),
  });

  /* --------------------------------------------------------- date_only clicks */

  const handleDateOnlyClick = (date: string) => {
    if (!rangeStart) {
      setRangeStart(date);
      setRangeEnd(null);
      setExcluded(new Set());
      return;
    }
    if (rangeEnd === null) {
      const [from, to] =
        toUTCms(date) >= toUTCms(rangeStart) ? [rangeStart, date] : [date, rangeStart];
      setRangeStart(from);
      setRangeEnd(to);
      return;
    }
    // A complete range exists: inside toggles an exclusion, outside starts over.
    if (committedRange.includes(date)) {
      setExcluded((previous) => {
        const next = new Set(previous);
        if (next.has(date)) next.delete(date);
        else next.add(date);
        return next;
      });
      return;
    }
    setRangeStart(date);
    setRangeEnd(null);
    setExcluded(new Set());
  };

  const reset = () => {
    setPicked(new Set());
    setRangeStart(null);
    setRangeEnd(null);
    setExcluded(new Set());
  };

  /* ------------------------------------------------------------------ render */

  const months = [view, addMonths(view.year, view.month, 1)];

  const stateFor = (date: string) => {
    if (mode === 'date_time') {
      return { chosen: picked.has(date), inRange: false, isExcluded: false, isEdge: false };
    }
    const inRange = rangeDates.includes(date);
    const isExcluded = excluded.has(date);
    const isEdge = date === rangeStart || date === rangeEnd;
    return { chosen: inRange && !isExcluded, inRange, isExcluded, isEdge };
  };

  // Two wordings, and CSS picks the one that matches the pointer: "click" and
  // "drag" mean something different under a finger, where a drag scrolls.
  const helper =
    mode === 'date_time'
      ? {
          mouse: 'Click or drag to pick the dates you want on the poll.',
          touch: 'Tap dates to pick them. To pick a run, press and hold, then drag.',
        }
      : rangeStart && !rangeEnd
        ? { mouse: 'Now click the last date of the range.', touch: 'Now tap the last date of the range.' }
        : rangeEnd
          ? {
              mouse: 'Click any date inside the range to leave it out.',
              touch: 'Tap any date inside the range to leave it out.',
            }
          : { mouse: 'Click the first date of the range.', touch: 'Tap the first date of the range.' };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn min-h-11 min-w-11 px-2 py-1 sm:min-h-0 sm:min-w-0"
            onClick={() => setView(addMonths(view.year, view.month, -1))}
            aria-label="Previous month"
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            type="button"
            className="btn min-h-11 min-w-11 px-2 py-1 sm:min-h-0 sm:min-w-0"
            onClick={() => setView(addMonths(view.year, view.month, 1))}
            aria-label="Next month"
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
        <p className="hint flex-1 text-right">
          <span className="pointer-coarse:hidden">{helper.mouse}</span>
          <span className="hidden pointer-coarse:inline">{helper.touch}</span>
        </p>
      </div>

      <div
        ref={surfaceRef}
        className="paint-surface grid gap-4 sm:grid-cols-2"
        onPointerDown={paint.onPointerDown}
        onPointerMove={paint.onPointerMove}
      >
        {months.map(({ year, month }) => (
          <div key={`${year}-${month}`}>
            <div className="mb-1.5 text-center text-[0.8125rem] font-semibold">
              {formatMonthTitle(year, month)}
            </div>
            <div className="mb-1 grid grid-cols-7 gap-px">
              {WEEKDAYS.map((day, index) => (
                <div
                  key={`${day}-${index}`}
                  className="num text-center text-[0.75rem] font-medium text-label"
                  aria-hidden="true"
                >
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px">
              {monthCells(year, month).map((date, index) => {
                if (!date) return <div key={`pad-${index}`} className="h-9" />;
                const { chosen, inRange, isExcluded, isEdge } = stateFor(date);
                const isToday = date === today;
                return (
                  <button
                    key={date}
                    type="button"
                    data-date={date}
                    aria-pressed={chosen}
                    aria-label={formatWeekdayMonthDay(date)}
                    onPointerEnter={() => mode === 'date_only' && setHoverDate(date)}
                    onClick={(event) => {
                      if (mode === 'date_only') handleDateOnlyClick(date);
                      // detail 0 means the button was activated from the keyboard,
                      // where no pointerdown ran to do the painting.
                      else if (event.detail === 0) applyPaint(date, !picked.has(date));
                    }}
                    className={[
                      // Full tap target on a phone, where mis-picking a date is
                      // the easiest mistake to make; back to compact once there
                      // is room for two months side by side.
                      'num relative h-11 rounded text-[0.8125rem] transition-colors sm:h-9',
                      chosen
                        ? 'bg-ramp-4 font-semibold text-ink'
                        : inRange
                          ? 'bg-ramp-1 text-ink'
                          : 'bg-surface text-ink hover:bg-ramp-1',
                      isExcluded ? 'line-through text-muted' : '',
                      isEdge && !isExcluded ? 'ring-1 ring-inset ring-ramp-5' : '',
                      isToday && !chosen ? 'ring-1 ring-inset ring-line' : '',
                      anchor === date ? 'paint-anchor' : '',
                    ].join(' ')}
                  >
                    {Number(date.slice(8, 10))}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="hint num" aria-live="polite">
          {selected.length === 0
            ? 'No dates picked yet'
            : `${selected.length} date${selected.length === 1 ? '' : 's'} picked`}
        </p>
        {selected.length > 0 || rangeStart ? (
          <button type="button" className="btn-link" onClick={reset}>
            Clear dates
          </button>
        ) : null}
      </div>
    </div>
  );
}
