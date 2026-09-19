'use client';

import { FULL_HOUSE_CLASS, isFullHouse, rampFillClass, rampStep } from '@/lib/results';

/** The ramp from nobody to everybody, in the same steps the grid uses. */
export default function Legend({ total }: { total: number }) {
  if (total === 0) return null;

  const marks =
    total <= 8
      ? Array.from({ length: total + 1 }, (_, count) => count)
      : [0, Math.round(total * 0.25), Math.round(total * 0.5), Math.round(total * 0.75), total];

  return (
    <div className="flex items-center gap-2">
      <span className="hint num shrink-0">0</span>
      <ul className="flex flex-1 gap-0.5">
        {marks.map((count) => (
          <li key={count} className="flex-1">
            <span
              className={[
                'block h-3 rounded-[2px] border border-line',
                isFullHouse(count, total) ? FULL_HOUSE_CLASS : rampFillClass(rampStep(count, total)),
              ].join(' ')}
              title={
                isFullHouse(count, total)
                  ? `Everyone — all ${total} available`
                  : `${count} of ${total} available`
              }
            />
          </li>
        ))}
      </ul>
      <span className="hint num shrink-0">{total}</span>
      <span className="sr-only">
        Colour intensity shows how many of the {total} respondents are free. Gold means all of them.
      </span>
    </div>
  );
}
