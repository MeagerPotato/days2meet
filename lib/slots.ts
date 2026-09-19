/**
 * The single source of truth for slot index math and grid geometry.
 *
 * Both the server (validating and storing `int[]`) and the client (painting the
 * grid) import from here, so the two can never disagree about what a slot index
 * means.
 *
 *   slotsPerDay = mode === 'date_only' ? 1 : (end_minute - start_minute) / slot_minutes
 *   slotIndex   = dateIndex * slotsPerDay + rowIndex
 *
 * In `date_only` mode slotsPerDay is 1, so slotIndex === dateIndex.
 *
 * This module must stay free of Node built-ins so it can be bundled for the browser.
 */

export type EventMode = 'date_time' | 'date_only';

/** Shared by event creation and by the leader's later edits, so the two agree. */
export const MAX_DATES = 180;
export const ALLOWED_GRANULARITY = [15, 30, 60];

export interface EventGeometry {
  mode: EventMode;
  /** Ordered ascending, `yyyy-MM-dd`. May contain gaps. */
  dates: string[];
  /** IANA zone the grid is defined in. Null when mode is `date_only`. */
  timezone: string | null;
  slotMinutes: number;
  /** Minutes past local midnight, inclusive. Null when mode is `date_only`. */
  startMinute: number | null;
  /** Minutes past local midnight, exclusive. Null when mode is `date_only`. */
  endMinute: number | null;
}

export interface Cell {
  dateIndex: number;
  rowIndex: number;
}

export function slotsPerDay(g: EventGeometry): number {
  if (g.mode === 'date_only') return 1;
  const span = (g.endMinute ?? 0) - (g.startMinute ?? 0);
  return Math.max(1, Math.floor(span / g.slotMinutes));
}

export function totalSlots(g: EventGeometry): number {
  return g.dates.length * slotsPerDay(g);
}

export function slotIndex(g: EventGeometry, dateIndex: number, rowIndex: number): number {
  return dateIndex * slotsPerDay(g) + rowIndex;
}

export function decodeSlot(g: EventGeometry, index: number): Cell {
  const perDay = slotsPerDay(g);
  return { dateIndex: Math.floor(index / perDay), rowIndex: index % perDay };
}

/** Minutes past local midnight at which `rowIndex` begins. */
export function rowStartMinute(g: EventGeometry, rowIndex: number): number {
  return (g.startMinute ?? 0) + rowIndex * g.slotMinutes;
}

/** Sorted ascending, deduplicated, and clamped to the event's slot range. */
export function normalizeSlots(raw: readonly number[], total: number): number[] {
  const seen = new Set<number>();
  for (const value of raw) {
    if (!Number.isInteger(value) || value < 0 || value >= total) continue;
    seen.add(value);
  }
  return [...seen].sort((a, b) => a - b);
}

export type SlotValidation =
  | { ok: true; slots: number[] }
  | { ok: false; message: string };

/** Strict check used by the API before anything is written. */
export function validateSlots(raw: unknown, total: number): SlotValidation {
  if (!Array.isArray(raw)) {
    return { ok: false, message: 'slots must be an array of numbers.' };
  }
  if (raw.length > total) {
    return { ok: false, message: `slots has more entries than this event has slots (${total}).` };
  }
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return { ok: false, message: 'slots must contain whole numbers only.' };
    }
    if (value < 0 || value >= total) {
      return { ok: false, message: `Slot ${value} is outside this event, which has slots 0 to ${total - 1}.` };
    }
  }
  return { ok: true, slots: normalizeSlots(raw as number[], total) };
}

export interface SlotRemap {
  slots: number[];
  /** Input slots that found no home on the new grid. */
  dropped: number;
}

/**
 * Carries stored answers across an edit to the event's dates or times.
 *
 * A slot index only means anything against the geometry it was recorded under,
 * so each one is decoded back to a real calendar date and time of day and then
 * re-encoded against the new grid.
 *
 * Each mark fills every row of `to` that overlaps the span of real time its old
 * slot covered. Coarsening 15 minutes to 30 lands two old rows on one new row,
 * which is no loss because slots are a set; refining 60 to 15 fans one old row
 * out across the four it contained, so nobody's hour shrinks to its first
 * quarter. `dropped` counts inputs that found nowhere to go — a removed date, or
 * a time now outside the window — not marks that merged.
 */
export function remapSlots(
  from: EventGeometry,
  to: EventGeometry,
  slots: readonly number[],
): SlotRemap {
  // A date_only index and a date_time index are different quantities, so there
  // is no honest answer here. Nothing may offer one.
  if (from.mode !== to.mode) {
    throw new Error('remapSlots cannot move answers between date_only and date_time.');
  }

  const targetDates = new Map<string, number>();
  to.dates.forEach((date, index) => targetDates.set(date, index));

  const toPerDay = slotsPerDay(to);
  const toStart = to.startMinute ?? 0;
  const toEnd = to.endMinute ?? 0;

  const kept = new Set<number>();
  let dropped = 0;

  for (const slot of slots) {
    const { dateIndex, rowIndex } = decodeSlot(from, slot);
    // An out-of-range index decodes to a date that is not in `from` at all,
    // which is the same "no home" answer as a date the organiser removed.
    const dateIndexInTo = targetDates.get(from.dates[dateIndex]);
    if (dateIndexInTo === undefined) {
      dropped += 1;
      continue;
    }

    if (to.mode === 'date_only') {
      kept.add(dateIndexInTo);
      continue;
    }

    const minute = rowStartMinute(from, rowIndex);
    if (minute < toStart || minute >= toEnd) {
      dropped += 1;
      continue;
    }

    // A source slot covers a span of time, not an instant. Landing only its
    // start minute is right when the new grid is coarser — many old slots fold
    // into one, and a set loses nothing — but when the new grid is finer, a
    // whole hour would otherwise collapse to its first sliver and quietly erase
    // most of someone's availability. So fill every new row the old slot
    // actually spanned, clamped to the window. Coarsening still lands on one row.
    const firstRow = Math.floor((minute - toStart) / to.slotMinutes);
    const coveredUntil = Math.min(minute + from.slotMinutes, toEnd);
    const lastRow = Math.floor((coveredUntil - 1 - toStart) / to.slotMinutes);

    let landed = false;
    for (let row = firstRow; row <= lastRow; row++) {
      if (row < 0 || row >= toPerDay) continue;
      kept.add(dateIndexInTo * toPerDay + row);
      landed = true;
    }
    if (!landed) dropped += 1;
  }

  return { slots: [...kept].sort((a, b) => a - b), dropped };
}

/**
 * Every slot index in the rectangle spanned by two cells. This is what a
 * When2meet drag paints: the full block between the anchor and the pointer,
 * not the path the pointer travelled.
 */
export function rectangleSlots(g: EventGeometry, a: Cell, b: Cell): number[] {
  const perDay = slotsPerDay(g);
  const d0 = Math.min(a.dateIndex, b.dateIndex);
  const d1 = Math.max(a.dateIndex, b.dateIndex);
  const r0 = Math.min(a.rowIndex, b.rowIndex);
  const r1 = Math.max(a.rowIndex, b.rowIndex);
  const out: number[] = [];
  for (let d = d0; d <= d1; d++) {
    if (d < 0 || d >= g.dates.length) continue;
    for (let r = r0; r <= r1; r++) {
      if (r < 0 || r >= perDay) continue;
      out.push(d * perDay + r);
    }
  }
  return out;
}

/* Shared pixel geometry, so the personal and group grids line up exactly.
   Sized for the 12px Inter labels: the gutter holds "10:30 AM" (57px) inside
   its 6px padding, and a column holds a 14px "12/31" (41.5px) inside its 4px. */

export const GUTTER_WIDTH = 64;
export const MIN_COLUMN_WIDTH = 46;
export const DAY_CELL_MIN_HEIGHT = 46;

export function rowHeightFor(slotMinutes: number): number {
  if (slotMinutes >= 60) return 44;
  if (slotMinutes >= 30) return 26;
  return 20;
}

/** Rows that start exactly on the hour get the heavier rule and a label. */
export function isHourBoundary(g: EventGeometry, rowIndex: number): boolean {
  return rowStartMinute(g, rowIndex) % 60 === 0;
}
