'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { formatDateSpan, formatMinuteOfDay } from '@/lib/dates';
import { DEFAULT_EMAIL_PROMPT, normalizeEmailPrompt } from '@/lib/identity';
import { remapSlots, type EventGeometry } from '@/lib/slots';
import type { EventPayload, ParticipantPayload } from '@/lib/types';

import ConfirmDialog from './ConfirmDialog';
import CopyEventLinkButton from './CopyEventLinkButton';
import CreationCalendar from './CreationCalendar';
import EmailRequirementField from './EmailRequirementField';

const GRANULARITIES = [15, 30, 60] as const;
const NOTICE_MS = 5000;

function timeOptions(from: number, to: number): number[] {
  const out: number[] = [];
  for (let minute = from; minute <= to; minute += 30) out.push(minute);
  return out;
}

const START_OPTIONS = timeOptions(0, 1410);
const END_OPTIONS = timeOptions(30, 1440);

function sameDates(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Everything the PATCH endpoint can change, as it currently stands on the server. */
interface Saved {
  title: string;
  dates: string[];
  startMinute: number | null;
  endMinute: number | null;
  slotMinutes: number;
  emailRequired: boolean;
  /** As stored: null means the default wording. */
  emailPrompt: string | null;
  responsesClosed: boolean;
}

interface Props {
  event: EventPayload;
}

export default function EditEventPanel({ event }: Props) {
  const timed = event.mode === 'date_time';

  const [saved, setSaved] = useState<Saved>(() => ({
    title: event.title,
    dates: event.dates,
    startMinute: event.startMinute,
    endMinute: event.endMinute,
    slotMinutes: event.slotMinutes,
    emailRequired: event.emailRequired,
    emailPrompt: event.emailPrompt,
    responsesClosed: event.responsesClosed,
  }));

  // Only the slots matter here, but they have to track the saved geometry: a
  // second edit in the same sitting must measure its cost against what the
  // server holds now, not against the marks that were already dropped.
  const [participants, setParticipants] = useState<ParticipantPayload[]>(event.participants);

  const [title, setTitle] = useState(event.title);
  const [dates, setDates] = useState<string[]>(event.dates);
  const [startMinute, setStartMinute] = useState(event.startMinute ?? 540);
  const [endMinute, setEndMinute] = useState(event.endMinute ?? 1020);
  const [slotMinutes, setSlotMinutes] = useState(event.slotMinutes);
  const [emailRequired, setEmailRequired] = useState(event.emailRequired);
  // Prefilled with the wording respondents see today, stored or default.
  const [emailPrompt, setEmailPrompt] = useState(event.emailPrompt ?? DEFAULT_EMAIL_PROMPT);
  const [responsesClosed, setResponsesClosed] = useState(event.responsesClosed);

  // Remounting the calendar is what puts it back to the saved span; it owns its
  // own selection and has no way to be told to reset.
  const [datesKey, setDatesKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  /* ---------------------------------------------------------------- geometry */

  const savedGeometry: EventGeometry = useMemo(
    () => ({
      mode: event.mode,
      dates: saved.dates,
      timezone: event.timezone,
      slotMinutes: saved.slotMinutes,
      startMinute: saved.startMinute,
      endMinute: saved.endMinute,
    }),
    [event.mode, event.timezone, saved],
  );

  const pendingGeometry: EventGeometry = useMemo(() => {
    // The server snaps the window outward to the granularity before it stores or
    // remaps anything (see the create/patch routes). Mirror that here, or the
    // impact preview and the confirm dialog count against a grid the server will
    // never build — promising a drop that does not happen, or hiding one that
    // does, whenever a bound sits off the granularity (9:30 on a 60-min grid).
    const snappedStart = timed ? Math.floor(startMinute / slotMinutes) * slotMinutes : null;
    const snappedEnd = timed ? Math.min(1440, Math.ceil(endMinute / slotMinutes) * slotMinutes) : null;
    return {
      mode: event.mode,
      dates,
      timezone: event.timezone,
      slotMinutes: timed ? slotMinutes : saved.slotMinutes,
      startMinute: snappedStart,
      endMinute: snappedEnd,
    };
  }, [event.mode, event.timezone, dates, timed, slotMinutes, startMinute, endMinute, saved.slotMinutes]);

  const datesChanged = !sameDates(dates, saved.dates);
  // Compared on the snapped bounds, not the raw select values, so nudging a
  // select to a time that rounds back to the same slot is correctly "no change"
  // — matching what would actually be sent and stored.
  const windowChanged =
    timed &&
    (pendingGeometry.startMinute !== saved.startMinute ||
      pendingGeometry.endMinute !== saved.endMinute ||
      slotMinutes !== saved.slotMinutes);
  // Only while the box is ticked: a message edited and then hidden again by
  // unticking is not something the planner can see, so it is not saved.
  const pendingPrompt = normalizeEmailPrompt(emailPrompt);
  const promptChanged = emailRequired && pendingPrompt !== saved.emailPrompt;
  const changed =
    title.trim() !== saved.title ||
    datesChanged ||
    windowChanged ||
    emailRequired !== saved.emailRequired ||
    promptChanged ||
    responsesClosed !== saved.responsesClosed;

  const valid = title.trim().length > 0 && dates.length > 0 && (!timed || endMinute > startMinute);

  /* -------------------------------------------------------- impact preview */

  const impact = useMemo(() => {
    // Mid-pick the calendar reports an empty list, which would read as "every
    // mark is about to be destroyed" while someone is halfway through clicking.
    if (dates.length === 0) return { dropped: 0, affected: 0 };

    let dropped = 0;
    let affected = 0;
    for (const person of participants) {
      const result = remapSlots(savedGeometry, pendingGeometry, person.slots);
      if (result.dropped === 0) continue;
      dropped += result.dropped;
      affected += 1;
    }
    return { dropped, affected };
  }, [participants, savedGeometry, pendingGeometry, dates.length]);

  const impactLine = useMemo(() => {
    if (impact.dropped === 0) return null;
    const boundary =
      datesChanged && windowChanged
        ? 'new dates and times'
        : windowChanged
          ? 'new time window'
          : 'new dates';
    return `${plural(impact.dropped, 'mark', 'marks')} from ${plural(
      impact.affected,
      'person',
      'people',
    )} ${impact.dropped === 1 ? 'falls' : 'fall'} outside the ${boundary} and will be dropped.`;
  }, [impact, datesChanged, windowChanged]);

  /* ------------------------------------------------------------------ saving */

  const flash = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  };

  const persist = async () => {
    setConfirming(false);
    setSaving(true);
    setError(null);

    const next: Saved = {
      title: title.trim(),
      dates,
      // The snapped bounds the server will actually store, so a second edit this
      // sitting measures its cost against the real grid, not the raw select
      // values that were rounded away.
      startMinute: timed ? pendingGeometry.startMinute : saved.startMinute,
      endMinute: timed ? pendingGeometry.endMinute : saved.endMinute,
      slotMinutes: timed ? slotMinutes : saved.slotMinutes,
      emailRequired,
      emailPrompt: promptChanged ? pendingPrompt : saved.emailPrompt,
      responsesClosed,
    };

    // Only what moved. `mode` and `timezone` are not editable, so they are never
    // in the body at all rather than sent unchanged and rejected.
    const body: Record<string, unknown> = {};
    if (next.title !== saved.title) body.title = next.title;
    if (datesChanged) body.dates = next.dates;
    if (timed) {
      if (next.startMinute !== saved.startMinute) body.startMinute = next.startMinute;
      if (next.endMinute !== saved.endMinute) body.endMinute = next.endMinute;
      if (next.slotMinutes !== saved.slotMinutes) body.slotMinutes = next.slotMinutes;
    }
    if (next.emailRequired !== saved.emailRequired) body.emailRequired = next.emailRequired;
    if (next.emailPrompt !== saved.emailPrompt) body.emailPrompt = next.emailPrompt;
    if (next.responsesClosed !== saved.responsesClosed) body.responsesClosed = next.responsesClosed;

    const from = savedGeometry;
    const to = pendingGeometry;

    try {
      const response = await fetch(`/api/events/${event.slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; dropped?: number; affected?: number; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? 'Could not save your changes. Try again.');
        setSaving(false);
        return;
      }

      // The server ran the same remap over the same slots, so this lands on the
      // rows it just wrote without a refetch.
      setParticipants((current) =>
        current.map((person) => ({ ...person, slots: remapSlots(from, to, person.slots).slots })),
      );
      setSaved(next);
      // Reseed the calendar from what was just saved, so "Undo date changes"
      // means the new dates rather than the ones this save replaced.
      setDatesKey((key) => key + 1);
      setSaving(false);

      const lost = payload.dropped ?? 0;
      flash(
        lost > 0
          ? `Saved. ${plural(lost, 'mark', 'marks')} ${lost === 1 ? 'was' : 'were'} dropped.`
          : 'Saved.',
      );
    } catch {
      setError('Could not reach the server. Your changes are not saved yet.');
      setSaving(false);
    }
  };

  const submit = (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    setError(null);
    setNotice(null);

    if (!title.trim()) {
      setError('Give the event a name.');
      return;
    }
    if (dates.length === 0) {
      setError('Pick at least one date.');
      return;
    }
    if (timed && endMinute <= startMinute) {
      setError('The end time has to come after the start time.');
      return;
    }

    if (impact.dropped > 0) {
      setConfirming(true);
      return;
    }
    void persist();
  };

  /* ------------------------------------------------------------------ render */

  return (
    <>
      <form onSubmit={submit} className="space-y-7">
        <div>
          <label className="label" htmlFor="event-title">
            Event name
          </label>
          <input
            id="event-title"
            className="field min-h-11"
            value={title}
            onChange={(field) => setTitle(field.target.value)}
            maxLength={120}
            required
          />
        </div>

        <div>
          <span className="label">Dates</span>
          <div className="panel p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <p className="num min-w-0 text-[0.875rem]">
                {dates.length === 0 ? (
                  <span className="text-muted">No dates picked yet</span>
                ) : (
                  <>
                    {formatDateSpan(dates)}
                    <span className="text-muted"> — {plural(dates.length, 'date', 'dates')}</span>
                  </>
                )}
              </p>
              {sameDates(dates, saved.dates) ? null : (
                <button
                  type="button"
                  className="btn-link -my-2 shrink-0 py-2 sm:my-0 sm:py-0"
                  onClick={() => setDatesKey((key) => key + 1)}
                >
                  Undo date changes
                </button>
              )}
            </div>

            {/* Seeded with what the event already covers, so the leader adjusts a
                span instead of rebuilding it from nothing. */}
            <CreationCalendar
              key={datesKey}
              mode={event.mode}
              onChange={setDates}
              initialDates={saved.dates}
            />
          </div>
        </div>

        {timed ? (
          <fieldset>
            <legend className="label">Time window</legend>
            {/* Same "9:00 AM to 5:00 PM" sentence as the create form. */}
            <div className="flex items-center gap-2 sm:gap-3">
              <select
                id="start-minute"
                aria-label="Start time"
                className="field num min-h-11 min-w-0 flex-1"
                value={startMinute}
                onChange={(field) => setStartMinute(Number(field.target.value))}
              >
                {START_OPTIONS.map((minute) => (
                  <option key={minute} value={minute}>
                    {formatMinuteOfDay(minute)}
                  </option>
                ))}
              </select>
              <span aria-hidden="true" className="shrink-0 text-[0.9375rem] text-muted">
                to
              </span>
              <select
                id="end-minute"
                aria-label="End time"
                className="field num min-h-11 min-w-0 flex-1"
                value={endMinute}
                onChange={(field) => setEndMinute(Number(field.target.value))}
              >
                {END_OPTIONS.map((minute) => (
                  <option key={minute} value={minute}>
                    {minute === 1440 ? '12:00 AM (midnight)' : formatMinuteOfDay(minute)}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-3">
              <span className="hint mb-1 block">Granularity</span>
              <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
                {GRANULARITIES.map((value) => (
                  <label
                    key={value}
                    className={[
                      'num flex min-h-11 cursor-pointer items-center rounded-md px-3 text-[0.8125rem] sm:min-h-10',
                      slotMinutes === value ? 'bg-ink text-paper' : 'text-ink hover:bg-ramp-1',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="granularity"
                      className="sr-only"
                      value={value}
                      checked={slotMinutes === value}
                      onChange={() => setSlotMinutes(value)}
                    />
                    {value} min
                  </label>
                ))}
              </div>
            </div>

            {event.timezone ? (
              <p className="hint mt-2">
                The grid stays in {event.timezone}. A timezone cannot be changed once people have
                answered in it.
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <EmailRequirementField
          required={emailRequired}
          onRequiredChange={setEmailRequired}
          prompt={emailPrompt}
          onPromptChange={setEmailPrompt}
        />

        <fieldset>
          <legend className="label">Responses</legend>
          <div className="rounded-lg border border-line bg-surface px-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem]">
              <input
                type="checkbox"
                className="size-4 shrink-0 cursor-pointer accent-ink"
                checked={responsesClosed}
                onChange={(field) => setResponsesClosed(field.target.checked)}
              />
              Close responses
            </label>
          </div>
          <p className="hint mt-1">
            Everyone can still open the link and read the results. Nobody can add an answer or
            change the one they gave.
          </p>
        </fieldset>

        <div className="border-t border-line pt-6">
          {dates.length === 0 ? (
            <p className="hint mb-3">Pick at least one date before saving.</p>
          ) : (
            <p className="hint mb-3 empty:mb-0" aria-live="polite">
              {impactLine}
            </p>
          )}

          {error ? (
            <p
              className="mb-3 rounded-lg border border-[#f0d4dc] bg-[#fdf3f5] px-3 py-2 text-[0.875rem] text-danger"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="btn btn-primary min-h-11 w-full sm:w-auto"
              disabled={saving || !changed || !valid}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <span className="hint" aria-live="polite">
              {notice}
            </span>
          </div>
        </div>
      </form>

      <section className="mt-7 border-t border-line pt-6">
        <h2 className="section-title mb-3">Other actions</h2>
        <div className="flex flex-wrap gap-2">
          <CopyEventLinkButton slug={event.slug} />
          {/* A plain anchor, not `Link`: the client router would treat this as a
              route to push and leave the page sitting on a JSON-less response,
              rather than letting the browser take the file. */}
          <a className="btn min-h-11 shrink-0" href={`/api/events/${event.slug}/export`} download>
            Export respondents
          </a>
          <Link className="btn btn-edit min-h-11 shrink-0" href={`/e/${event.slug}`}>
            Back to the days2meet
          </Link>
        </div>
      </section>

      {confirming ? (
        <ConfirmDialog
          title={`Drop ${plural(impact.dropped, 'mark', 'marks')}?`}
          body={[impactLine, 'This cannot be undone.'].filter(Boolean).join(' ')}
          confirmLabel="Save"
          onConfirm={() => void persist()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
