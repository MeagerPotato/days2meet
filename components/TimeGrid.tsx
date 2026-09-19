'use client';

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { formatColumnHeader, formatMinuteOfDay } from '@/lib/dates';
import { FULL_HOUSE_CLASS, isFullHouse, rampFillClass, rampStep } from '@/lib/results';
import {
  GUTTER_WIDTH,
  MIN_COLUMN_WIDTH,
  isHourBoundary,
  rectangleSlots,
  rowHeightFor,
  rowStartMinute,
  slotsPerDay,
  type Cell,
  type EventGeometry,
} from '@/lib/slots';
import HighlightOverlay from './HighlightOverlay';
import PaintStatus from './PaintStatus';
import { usePaintGesture } from './usePaintGesture';

export interface HoverPayload {
  slot: number;
  x: number;
  y: number;
  pinned: boolean;
}

interface Props {
  geometry: EventGeometry;
  editable: boolean;
  /** Your own marks. Only meaningful when `editable`. */
  selected: Set<number>;
  onCommit?: (next: Set<number>) => void;
  /** Fires the moment a drag starts, so polling can stop overwriting local edits. */
  onPaintStart?: () => void;
  /** Group headcount per slot. Only meaningful when not `editable`. */
  counts?: readonly number[];
  totalParticipants?: number;
  /** Roster filter: slots outside this set drop back. Null means no filter. */
  filterSet?: Set<number> | null;
  highlightKeys?: string[] | null;
  onHover?: (payload: HoverPayload | null) => void;
  /** Minutes to add to gutter labels so they read in the viewer's timezone. */
  gutterShiftMinutes?: number;
  dstFlags?: boolean[];
}

/* Phone geometry. Narrow enough that a full week fits a 360px screen; the
   desktop numbers still come from lib/slots. Both grids on the page read the
   same values, so the personal and group grids stay aligned at every width. */
const COMPACT_GUTTER_WIDTH = 46;
/**
 * The phone gutter when the clock labels carry minutes ("10:30 AM"), which
 * happens when they are relabelled across a half-hour offset. That label is
 * 57px at 12px Inter, so it needs this much room to stay on one line. Whole-hour
 * labels ("10 AM", 38px) keep the narrow gutter and the full week.
 */
const COMPACT_GUTTER_WIDTH_MINUTES = 62;
const COMPACT_COLUMN_WIDTH = 40;
/** How far a phone column may shrink to avoid scrolling sideways. Fits "12/31" at 11px. */
const COMPACT_COLUMN_FLOOR = 33;

/** Row height under a finger, where 20px is too small a target to hit reliably. */
function touchRowHeightFor(slotMinutes: number): number {
  if (slotMinutes >= 60) return 44;
  if (slotMinutes >= 30) return 30;
  return 24;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function gutterLabel(minute: number): string {
  const total = ((minute % 1440) + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  const mins = total % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  return mins === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(mins).padStart(2, '0')} ${suffix}`;
}

function slotOfElement(element: Element | null): number | null {
  const cell = element?.closest<HTMLElement>('[data-cell]');
  if (!cell?.dataset.cell) return null;
  return Number(cell.dataset.cell);
}

function readOnlySlotOf(element: Element | null): HTMLElement | null {
  return element?.closest<HTMLElement>('[data-slot]') ?? null;
}

interface SlotCellProps {
  slot: number;
  editable: boolean;
  label: string;
  isMine: boolean;
  fillClass: string;
  dimmed: boolean;
  tabStop: boolean;
  anchor: boolean;
  hourLine: boolean;
  lastColumn: boolean;
  lastRow: boolean;
}

/**
 * Memoised so a paint only re-renders the cells whose state actually changed.
 * A 9-day, 15-minute grid is ~470 of these, and on a low-end phone rebuilding
 * all of them on every pointermove is what makes painting lag the finger.
 * Every prop is a primitive for the same reason; the handlers live on the
 * surface, not on each cell.
 */
const SlotCell = memo(function SlotCell({
  slot,
  editable,
  label,
  isMine,
  fillClass,
  dimmed,
  tabStop,
  anchor,
  hourLine,
  lastColumn,
  lastRow,
}: SlotCellProps) {
  return (
    <div
      role="gridcell"
      aria-label={label}
      aria-selected={editable ? isMine : undefined}
      data-cell={editable ? slot : undefined}
      data-slot={editable ? undefined : slot}
      data-hl={`s${slot}`}
      tabIndex={editable ? (tabStop ? 0 : -1) : undefined}
      className={[
        // Keyboard focus scrolls the cell clear of the sticky header and gutter.
        'slot-row relative scroll-mt-[calc(var(--sticky-top,0px)+3.5rem)] scroll-ml-[var(--gutter)] border-l border-l-line/70',
        hourLine ? 'border-t border-t-line' : 'border-t border-t-[#f1f2f5]',
        lastColumn ? 'border-r border-r-line/70' : '',
        lastRow ? 'border-b border-b-line' : '',
        editable
          ? isMine
            ? 'bg-[#faefc9] shadow-[inset_0_0_0_1px_var(--color-you)]'
            : 'bg-surface hover:bg-[#fdf8e8]'
          : fillClass,
        editable ? 'cursor-pointer' : '',
        dimmed ? 'opacity-15' : '',
        anchor ? 'paint-anchor' : '',
      ].join(' ')}
    />
  );
});

export default function TimeGrid({
  geometry,
  editable,
  selected,
  onCommit,
  onPaintStart,
  counts,
  totalParticipants = 0,
  filterSet = null,
  highlightKeys = null,
  onHover,
  gutterShiftMinutes = 0,
  dstFlags,
}: Props) {
  const perDay = slotsPerDay(geometry);
  const columnCount = geometry.dates.length;
  const contentRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const [preview, setPreviewState] = useState<{ slots: Set<number>; adding: boolean } | null>(null);
  const previewRef = useRef<{ slots: Set<number>; adding: boolean } | null>(null);
  const dragRef = useRef<{ anchor: Cell; adding: boolean } | null>(null);
  /** The touch anchor, lit while a finger paints. A mouse needs no such cue. */
  const [anchor, setAnchor] = useState<number | null>(null);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const setPreview = (next: { slots: Set<number>; adding: boolean } | null) => {
    previewRef.current = next;
    setPreviewState(next);
  };

  const [focusCell, setFocusCell] = useState<Cell>({ dateIndex: 0, rowIndex: 0 });
  const keyboardAnchor = useRef<Cell | null>(null);
  const hasFocus = useRef(false);

  const cellOf = (slot: number): Cell => ({
    dateIndex: Math.floor(slot / perDay),
    rowIndex: slot % perDay,
  });

  /** What the grid shows right now, including an in-flight drag. */
  const shown = useMemo(() => {
    if (!preview) return selected;
    const next = new Set(selected);
    for (const slot of preview.slots) {
      if (preview.adding) next.add(slot);
      else next.delete(slot);
    }
    return next;
  }, [selected, preview]);

  const toggle = (slot: number) => {
    if (!editable) return;
    const next = new Set(selectedRef.current);
    if (next.has(slot)) next.delete(slot);
    else next.add(slot);
    onCommit?.(next);
  };

  const paint = usePaintGesture<number>({
    enabled: editable,
    surfaceRef,
    scrollerRef,
    keyOf: slotOfElement,
    onBegin: (slot, pointerType) => {
      onPaintStart?.();
      const adding = !selectedRef.current.has(slot);
      dragRef.current = { anchor: cellOf(slot), adding };
      if (pointerType !== 'mouse') setAnchor(slot);
      setPreview({ slots: new Set([slot]), adding });
    },
    onExtend: (slot) => {
      const drag = dragRef.current;
      if (!drag) return;
      setPreview({
        slots: new Set(rectangleSlots(geometry, drag.anchor, cellOf(slot))),
        adding: drag.adding,
      });
    },
    onEnd: () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setAnchor(null);
      const current = previewRef.current;
      previewRef.current = null;
      setPreviewState(null);
      if (!drag || !current) return;
      const next = new Set(selectedRef.current);
      for (const slot of current.slots) {
        if (current.adding) next.add(slot);
        else next.delete(slot);
      }
      onCommit?.(next);
    },
    onTap: (slot) => {
      onPaintStart?.();
      toggle(slot);
    },
  });

  useEffect(() => {
    if (!hasFocus.current) return;
    const slot = focusCell.dateIndex * perDay + focusCell.rowIndex;
    contentRef.current?.querySelector<HTMLElement>(`[data-cell="${slot}"]`)?.focus();
  }, [focusCell, perDay]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editable) return;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      keyboardAnchor.current = null;
      toggle(focusCell.dateIndex * perDay + focusCell.rowIndex);
      return;
    }

    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();

    const next: Cell = {
      dateIndex: clamp(focusCell.dateIndex + delta[0], 0, columnCount - 1),
      rowIndex: clamp(focusCell.rowIndex + delta[1], 0, perDay - 1),
    };

    if (event.shiftKey) {
      if (!keyboardAnchor.current) keyboardAnchor.current = focusCell;
      const merged = new Set(selected);
      for (const slot of rectangleSlots(geometry, keyboardAnchor.current, next)) merged.add(slot);
      onCommit?.(merged);
    } else {
      keyboardAnchor.current = null;
    }
    setFocusCell(next);
  };

  /* ------------------------------------------------ read-only hover and tap */

  const hoverSlot = useRef<number | null>(null);
  const lastPointerType = useRef('mouse');

  const reportCell = (cell: HTMLElement, pinned: boolean) => {
    const box = cell.getBoundingClientRect();
    onHover?.({ slot: Number(cell.dataset.slot), x: box.left + box.width / 2, y: box.top, pinned });
  };

  const readOnlyHandlers = editable
    ? {}
    : {
        onPointerOver: (event: React.PointerEvent<HTMLDivElement>) => {
          if (event.pointerType === 'touch') return;
          const cell = readOnlySlotOf(event.target as Element);
          if (!cell) return;
          const slot = Number(cell.dataset.slot);
          if (slot === hoverSlot.current) return;
          hoverSlot.current = slot;
          reportCell(cell, false);
        },
        onPointerOut: (event: React.PointerEvent<HTMLDivElement>) => {
          if (event.pointerType === 'touch') return;
          // Moving straight onto another cell is handled by its pointerover.
          const to = readOnlySlotOf(event.relatedTarget as Element | null);
          if (to && event.currentTarget.contains(to)) return;
          hoverSlot.current = null;
          onHover?.(null);
        },
        // A tap, not a pointerdown: a swipe that starts on the grid is a scroll
        // and should not pop a tooltip up on its way past.
        onClick: (event: React.MouseEvent<HTMLDivElement>) => {
          if (lastPointerType.current === 'mouse') return;
          const cell = readOnlySlotOf(event.target as Element);
          if (cell) reportCell(cell, true);
        },
      };

  /* ------------------------------------------------------------- geometry */

  const rowHeight = rowHeightFor(geometry.slotMinutes);
  const touchRowHeight = touchRowHeightFor(geometry.slotMinutes);
  const template = `var(--gutter) repeat(${columnCount}, minmax(var(--col-min), 1fr))`;
  // Header and body are separate grids (the header has to be sticky against
  // the page, which it cannot be from inside a horizontal scroller). Both get
  // this exact minimum width and a fixed minimum per track, so no header label
  // can widen a column and throw the two out of line.
  const minWidth = `calc(var(--gutter) + ${columnCount} * var(--col-min))`;
  // Labels sit on the event's whole hours, so they only gain minutes when the
  // relabel shift is not a whole number of hours. Both grids on the page get
  // the same shift, so they still share one gutter width.
  const labelsHaveMinutes = gutterShiftMinutes % 60 !== 0;
  const gridVars = {
    '--gutter-wide': `${GUTTER_WIDTH}px`,
    '--gutter-compact': `${labelsHaveMinutes ? COMPACT_GUTTER_WIDTH_MINUTES : COMPACT_GUTTER_WIDTH}px`,
    '--col-min-wide': `${MIN_COLUMN_WIDTH}px`,
    '--col-min-compact': `${COMPACT_COLUMN_WIDTH}px`,
    '--col-min-floor': `${COMPACT_COLUMN_FLOOR}px`,
    '--cols': columnCount,
    '--slot-h': `${rowHeight}px`,
    '--slot-h-touch': `${touchRowHeight}px`,
  } as CSSProperties;

  const columns = useMemo(
    () => geometry.dates.map((date) => formatColumnHeader(date)),
    [geometry.dates],
  );
  // On a phone the date line is 12px, but a five-character date ("12/31") is
  // 36px wide at that size, more than the 33px a squeezed phone column keeps.
  // Grids that have one drop the whole line to 11px (33px), so every column
  // matches and a full week still fits without scrolling sideways.
  const hasLongDate = columns.some(({ monthDay }) => monthDay.length > 4);

  const rows = useMemo(
    () =>
      Array.from({ length: perDay }, (_, rowIndex) => {
        const minute = rowStartMinute(geometry, rowIndex);
        return { minute, hourLine: isHourBoundary(geometry, rowIndex), time: formatMinuteOfDay(minute) };
      }),
    [geometry, perDay],
  );

  // Keep the header over the columns it names. Scrolling either one moves the
  // other; the equality check stops the pair from echoing each other.
  const syncScroll = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
  };

  return (
    <div
      role="grid"
      aria-label={editable ? 'Your availability' : 'Group availability'}
      aria-readonly={!editable}
      className="time-grid relative"
      style={gridVars}
      onKeyDown={handleKeyDown}
      onFocus={(event) => {
        hasFocus.current = true;
        const slot = slotOfElement(event.target as Element);
        if (slot === null) return;
        const cell = cellOf(slot);
        if (cell.dateIndex !== focusCell.dateIndex || cell.rowIndex !== focusCell.rowIndex) {
          setFocusCell(cell);
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) hasFocus.current = false;
      }}
    >
      {/* Column headers — sticky under whatever the page pins above them. */}
      <div
        ref={headerRef}
        role="rowgroup"
        className="scrollbar-none sticky z-20 overflow-x-auto bg-paper"
        style={{ top: 'var(--sticky-top, 0px)' }}
        onScroll={() => syncScroll(headerRef.current, scrollerRef.current)}
      >
        <div role="row" className="grid" style={{ gridTemplateColumns: template, minWidth }}>
          <div role="columnheader" className="sticky left-0 z-10 bg-paper">
            <span className="sr-only">Time</span>
          </div>
          {columns.map(({ weekday, monthDay }, dateIndex) => {
            const dst = dstFlags?.[dateIndex] ?? false;
            return (
              <div
                key={geometry.dates[dateIndex]}
                role="columnheader"
                className="min-w-0 pb-1.5 pt-1 text-center sm:px-0.5"
              >
                <div className="num text-[0.75rem] font-medium leading-tight text-label">{weekday}</div>
                <div
                  className={`num ${hasLongDate ? 'text-[0.6875rem]' : 'text-[0.75rem]'} font-semibold leading-tight text-ink sm:text-[0.875rem]`}
                >
                  {monthDay}
                </div>
                {dst ? (
                  <span
                    className="chip mt-0.5 px-1 py-0 text-[0.5625rem] text-muted"
                    title="Daylight saving time shifts on this day. The grid keeps the event's hours; only the clock labels move by an hour."
                  >
                    DST
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="scroll-x"
        onScroll={() => syncScroll(scrollerRef.current, headerRef.current)}
      >
        <div ref={contentRef} className="relative" style={{ minWidth }}>
          <div
            ref={surfaceRef}
            role="rowgroup"
            className="paint-surface grid"
            style={{ gridTemplateColumns: template }}
            onPointerDown={(event) => {
              lastPointerType.current = event.pointerType;
              paint.onPointerDown(event);
            }}
            onPointerMove={editable ? paint.onPointerMove : undefined}
            {...readOnlyHandlers}
          >
            {rows.map(({ minute, hourLine, time }, rowIndex) => (
              <div key={rowIndex} role="row" style={{ display: 'contents' }}>
                <div
                  role="rowheader"
                  className="slot-row sticky left-0 z-10 bg-paper pr-1 text-right sm:pr-1.5"
                >
                  {hourLine ? (
                    <span className="num inline-block whitespace-nowrap text-[0.75rem] font-medium leading-none text-label">
                      {gutterLabel(minute + gutterShiftMinutes)}
                    </span>
                  ) : null}
                </div>

                {columns.map(({ weekday, monthDay }, dateIndex) => {
                  const slot = dateIndex * perDay + rowIndex;
                  const isMine = shown.has(slot);
                  const count = counts?.[slot] ?? 0;
                  const label = editable
                    ? `${weekday} ${monthDay}, ${time}, ${isMine ? 'free' : 'not free'}`
                    : `${weekday} ${monthDay}, ${time}, ${count} of ${totalParticipants} available`;
                  return (
                    <SlotCell
                      key={slot}
                      slot={slot}
                      editable={editable}
                      label={label}
                      isMine={isMine}
                      fillClass={
                        editable
                          ? ''
                          : isFullHouse(count, totalParticipants)
                            ? FULL_HOUSE_CLASS
                            : rampFillClass(rampStep(count, totalParticipants))
                      }
                      dimmed={filterSet !== null && !filterSet.has(slot)}
                      tabStop={
                        editable &&
                        focusCell.dateIndex === dateIndex &&
                        focusCell.rowIndex === rowIndex
                      }
                      anchor={anchor === slot}
                      hourLine={hourLine}
                      lastColumn={dateIndex === columnCount - 1}
                      lastRow={rowIndex === perDay - 1}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          <HighlightOverlay containerRef={contentRef} keys={highlightKeys} shape="outline" />
        </div>
      </div>

      {paint.touchPainting && preview ? (
        <PaintStatus adding={preview.adding} count={preview.slots.size} unit="slot" />
      ) : null}
    </div>
  );
}
