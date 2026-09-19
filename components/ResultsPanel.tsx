'use client';

import { useEffect, useMemo, useState } from 'react';

import { formatColumnHeader, formatMinuteRange, formatMonthDay } from '@/lib/dates';
import {
  alwaysFreeNames,
  buildSlotSets,
  longestStretches,
  rankDays,
  splitByAvailability,
  topTimeWindows,
  type ParticipantLite,
} from '@/lib/results';
import { rowStartMinute, type EventGeometry } from '@/lib/slots';

interface Props {
  geometry: EventGeometry;
  participants: ParticipantLite[];
  counts: number[];
  onHighlight: (keys: string[] | null) => void;
  /**
   * Added to every time shown here, matching the grid's gutter, so "Label in my
   * time" moves the best-times list along with everything else rather than
   * leaving it in event time while the header claims the viewer's.
   */
  labelShiftMinutes?: number;
}

function NameList({ names, empty }: { names: string[]; empty: string }) {
  if (names.length === 0) return <span className="text-muted">{empty}</span>;
  return <>{names.join(', ')}</>;
}

export default function ResultsPanel({
  geometry,
  participants,
  counts,
  onHighlight,
  labelShiftMinutes = 0,
}: Props) {
  const total = participants.length;
  const slotSets = useMemo(() => buildSlotSets(participants), [participants]);
  const [threshold, setThreshold] = useState(Math.max(1, total));
  const [dayThreshold, setDayThreshold] = useState(1);

  // A shrinking roster can leave either slider pointing past its own maximum.
  useEffect(() => {
    const clamp = (current: number) => Math.min(Math.max(1, current), Math.max(1, total));
    setThreshold(clamp);
    setDayThreshold(clamp);
  }, [total]);

  const windows = useMemo(
    () => (geometry.mode === 'date_time' ? topTimeWindows(geometry, counts, 5) : []),
    [geometry, counts],
  );

  const rankedDays = useMemo(
    () => (geometry.mode === 'date_only' ? rankDays(geometry, counts) : []),
    [geometry, counts],
  );

  // A day nobody can make is not a candidate, so it only pads the list — which is
  // why the slider floors at 1 rather than 0.
  const days = useMemo(
    () => rankedDays.filter((day) => day.count >= dayThreshold),
    [rankedDays, dayThreshold],
  );

  // rankDays sorts by headcount, so the head of the list is the best any day does.
  const bestDayCount = rankedDays[0]?.count ?? 0;

  const stretches = useMemo(
    () =>
      geometry.mode === 'date_only' ? longestStretches(geometry, counts, threshold, 3) : [],
    [geometry, counts, threshold],
  );

  if (geometry.mode === 'date_time') {
    return (
      <section aria-labelledby="results-heading">
        <h3 id="results-heading" className="section-title mb-2">
          Best times to meet
        </h3>
        {windows.length === 0 ? (
          <p className="hint">No one has marked any time yet.</p>
        ) : (
          <ol className="space-y-1">
            {windows.map((window) => {
              const start = rowStartMinute(geometry, window.startRow) + labelShiftMinutes;
              const end = rowStartMinute(geometry, window.endRow) + geometry.slotMinutes + labelShiftMinutes;
              const header = formatColumnHeader(window.date);
              const names = alwaysFreeNames(participants, window.slots);
              return (
                <li key={window.key}>
                  <div
                    className="group cursor-default rounded-md border border-line bg-surface px-2.5 py-1.5 transition-colors hover:border-ramp-4 focus-within:border-ramp-4"
                    tabIndex={0}
                    onMouseEnter={() => onHighlight(window.slots.map((slot) => `s${slot}`))}
                    onMouseLeave={() => onHighlight(null)}
                    onFocus={() => onHighlight(window.slots.map((slot) => `s${slot}`))}
                    onBlur={() => onHighlight(null)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="num text-[0.875rem]">
                        {header.weekday} {header.monthDay}, {formatMinuteRange(start, end)}
                      </span>
                      <span className="num shrink-0 text-[0.875rem] font-semibold">
                        {window.minCount}/{total}
                      </span>
                    </div>
                    <p className="hint mt-0.5 hidden group-hover:block group-focus-within:block pointer-coarse:block">
                      <NameList names={names} empty="No one" />
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section aria-labelledby="best-days-heading">
        <h3 id="best-days-heading" className="section-title mb-2">
          Best days to meet
        </h3>

        {days.length === 0 ? (
          // Nobody answering and nobody clearing the bar look identical in the
          // list, so the two need wording you can act on differently.
          <p className="hint">
            {bestDayCount === 0 ? (
              'No one has marked a day yet.'
            ) : (
              <>
                No days with <span className="num">{dayThreshold}</span> of{' '}
                <span className="num">{total}</span> available.
              </>
            )}
          </p>
        ) : (
          <ol className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
            {days.map((day) => {
              const { available, unavailable } = splitByAvailability(
                participants,
                slotSets,
                day.dateIndex,
              );
              return (
                <li key={day.date}>
                  <div
                    className="group cursor-default rounded-md px-2 py-1 transition-colors hover:bg-ramp-1 focus-within:bg-ramp-1"
                    tabIndex={0}
                    onMouseEnter={() => onHighlight([`s${day.dateIndex}`])}
                    onMouseLeave={() => onHighlight(null)}
                    onFocus={() => onHighlight([`s${day.dateIndex}`])}
                    onBlur={() => onHighlight(null)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="num w-[3.75rem] shrink-0 text-[0.875rem]">
                        {formatMonthDay(day.date)}
                      </span>
                      <span
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
                        aria-hidden="true"
                      >
                        <span
                          className="block h-full rounded-full bg-ramp-4"
                          style={{ width: total > 0 ? `${(day.count / total) * 100}%` : '0%' }}
                        />
                      </span>
                      <span className="num shrink-0 text-[0.875rem] font-semibold">
                        {day.count}/{total}
                      </span>
                    </div>
                    <p className="hint mt-0.5 hidden pl-[3.75rem] group-hover:block group-focus-within:block">
                      <NameList names={available} empty="No one" />
                      {unavailable.length > 0 ? (
                        <span className="text-muted"> — out: {unavailable.join(', ')}</span>
                      ) : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* Stays inside this section so the label still names the list above it. */}
        <div className="mt-2">
          <label className="hint mb-1 block" htmlFor="day-threshold">
            Show days with at least{' '}
            <span className="num font-semibold text-ink">{dayThreshold}</span> of{' '}
            <span className="num">{total}</span> available
          </label>
          <input
            id="day-threshold"
            type="range"
            min={1}
            max={Math.max(1, total)}
            step={1}
            value={dayThreshold}
            disabled={total <= 1}
            onChange={(event) => setDayThreshold(Number(event.target.value))}
            className="w-full min-h-11 accent-[var(--color-ramp-5)] sm:min-h-0"
          />
        </div>
      </section>

      <section aria-labelledby="stretches-heading">
        <h3 id="stretches-heading" className="section-title mb-1">
          Longest stretches
        </h3>

        <div className="mb-2">
          <label className="hint mb-1 block" htmlFor="stretch-threshold">
            At least <span className="num font-semibold text-ink">{threshold}</span> of{' '}
            <span className="num">{total}</span> free every day
          </label>
          <input
            id="stretch-threshold"
            type="range"
            min={1}
            max={Math.max(1, total)}
            step={1}
            value={threshold}
            disabled={total <= 1}
            onChange={(event) => setThreshold(Number(event.target.value))}
            // The track stays thin; the taller box is hit area, so a thumb this
            // small is still draggable with a thumb that size.
            className="w-full min-h-11 accent-[var(--color-ramp-5)] sm:min-h-0"
          />
        </div>

        {stretches.length === 0 ? (
          <p className="hint">
            No run of days has {threshold} {threshold === 1 ? 'person' : 'people'} free. Lower the
            threshold.
          </p>
        ) : (
          <ol className="space-y-1">
            {stretches.map((stretch) => {
              const slots = Array.from(
                { length: stretch.length },
                (_, offset) => stretch.startIndex + offset,
              );
              const names = alwaysFreeNames(participants, slots);
              return (
                <li key={stretch.key}>
                  <div
                    className="group cursor-default rounded-md border border-line bg-surface px-2.5 py-1.5 transition-colors hover:border-ramp-4 focus-within:border-ramp-4"
                    tabIndex={0}
                    onMouseEnter={() => onHighlight(slots.map((slot) => `s${slot}`))}
                    onMouseLeave={() => onHighlight(null)}
                    onFocus={() => onHighlight(slots.map((slot) => `s${slot}`))}
                    onBlur={() => onHighlight(null)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="num text-[0.875rem]">
                        {formatMonthDay(stretch.dates[0])} – {formatMonthDay(stretch.dates[stretch.length - 1])}{' '}
                        <span className="text-muted">
                          ({stretch.length} day{stretch.length === 1 ? '' : 's'})
                        </span>
                      </span>
                      <span className="num shrink-0 text-[0.875rem] font-semibold">
                        {stretch.minCount}/{total}
                      </span>
                    </div>
                    <p className="hint mt-0.5 hidden group-hover:block group-focus-within:block pointer-coarse:block">
                      Free every day: <NameList names={names} empty="no one" />
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
