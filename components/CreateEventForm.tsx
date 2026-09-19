'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { formatMinuteOfDay } from '@/lib/dates';
import { shareOrigin } from '@/lib/site';
import type { EventMode } from '@/lib/slots';
import { listTimeZones, resolveViewerTimeZone } from '@/lib/timezone';
import {
  DEFAULT_EMAIL_PROMPT,
  leaderPasswordProblem,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeEmailPrompt,
} from '@/lib/identity';
import CreationCalendar from './CreationCalendar';
import EmailRequirementField from './EmailRequirementField';
import ShareDialog from './ShareDialog';
import StarBanner from './StarBanner';

const GRANULARITIES = [15, 30, 60] as const;

/**
 * One fixed example makes this look like a holiday planner. Cycling a spread of
 * them shows the range without spending a line of copy on it. Kept short so
 * nothing is clipped in the field on a 375px screen.
 */
const TITLE_SUGGESTIONS = [
  'Winter break trip',
  'Weekly design sync',
  'Board game night',
  'Finals study group',
  "Nana's 80th",
  'Sprint retro',
  'Climbing gym meetup',
  'Thanksgiving with family',
  'Thesis check-in',
  'Cousins reunion weekend',
] as const;

const SUGGESTION_MS = 3500;

function timeOptions(from: number, to: number): number[] {
  const out: number[] = [];
  for (let minute = from; minute <= to; minute += 30) out.push(minute);
  return out;
}

const START_OPTIONS = timeOptions(0, 1410);
const END_OPTIONS = timeOptions(30, 1440);

export default function CreateEventForm() {
  const router = useRouter();
  const zones = useMemo(() => listTimeZones(), []);

  const [title, setTitle] = useState('');
  const [leaderName, setLeaderName] = useState('');
  const [leaderPassword, setLeaderPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<EventMode>('date_only');
  const [dates, setDates] = useState<string[]>([]);
  const [startMinute, setStartMinute] = useState(540); // 9:00 AM
  const [endMinute, setEndMinute] = useState(1020); // 5:00 PM
  const [slotMinutes, setSlotMinutes] = useState<number>(30);
  const [timezone, setTimezone] = useState(() => resolveViewerTimeZone());
  const [emailRequired, setEmailRequired] = useState(false);
  // Kept while the box is unticked, so ticking it again brings the text back.
  const [emailPrompt, setEmailPrompt] = useState(DEFAULT_EMAIL_PROMPT);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ slug: string; url: string } | null>(null);

  const [suggestion, setSuggestion] = useState(0);
  const [titleTouched, setTitleTouched] = useState(false);

  // Index 0 on both server and client, and it only moves after mount — a random
  // or clock-derived start would render differently in the two places and throw
  // a hydration mismatch. The rotation also stops for good once the field has
  // been touched, because a placeholder changing under someone mid-thought
  // reads as a glitch.
  useEffect(() => {
    if (titleTouched) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = window.setInterval(() => {
      setSuggestion((current) => (current + 1) % TITLE_SUGGESTIONS.length);
    }, SUGGESTION_MS);
    return () => window.clearInterval(timer);
  }, [titleTouched]);

  const changeMode = (next: EventMode) => {
    setMode(next);
    setDates([]);
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Give the event a name.');
      return;
    }
    const organiser = leaderName.trim();
    if (!organiser) {
      setError('Enter your name so everyone knows who the event planner is.');
      return;
    }
    // Not trimmed: whatever was typed is the secret, and signin compares it as
    // typed.
    const passwordProblem = leaderPasswordProblem(leaderPassword);
    if (passwordProblem) {
      setError(passwordProblem);
      return;
    }
    if (dates.length === 0) {
      setError(
        mode === 'date_only'
          ? 'Pick a date range on the calendar.'
          : 'Pick at least one date on the calendar.',
      );
      return;
    }
    if (mode === 'date_time' && endMinute <= startMinute) {
      setError('The end time has to come after the start time.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          leaderName: organiser,
          leaderPassword,
          mode,
          dates,
          // Every event asks for an address now. The checkbox only decides
          // whether a respondent is allowed to leave the box empty.
          collectEmail: true,
          emailRequired,
          // Null for the untouched default, so the event follows the app's
          // wording rather than a frozen copy of it.
          ...(emailRequired ? { emailPrompt: normalizeEmailPrompt(emailPrompt) } : {}),
          ...(mode === 'date_time' ? { timezone, startMinute, endMinute, slotMinutes } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { slug?: string; error?: string }
        | null;

      if (!response.ok || !payload?.slug) {
        setError(payload?.error ?? 'Could not create the event. Try again.');
        setSubmitting(false);
        return;
      }
      // Left submitting: the event exists from here on, so the form must never
      // run again. The dialog is the only way forward.
      setCreated({ slug: payload.slug, url: `${shareOrigin()}/e/${payload.slug}` });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSubmitting(false);
    }
  };

  return (
    <>
      {/*
        Two parts. Everything above the "Optional" divider has to be answered
        (or already is, by a default) before the event can exist; everything
        below it can be left exactly as it is. Mode, the time window and the
        timezone stay up top: the create route rejects a timed event without
        them, and mode has to sit above the calendar because changing it clears
        the dates picked so far.
      */}
      <form onSubmit={submit} className="space-y-7">
        <div>
          <label className="label" htmlFor="event-title">
            Event name
          </label>
          <input
            id="event-title"
            className="field min-h-11"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleTouched(true);
            }}
            onFocus={() => setTitleTouched(true)}
            placeholder={TITLE_SUGGESTIONS[suggestion]}
            maxLength={120}
            required
          />
        </div>

        {/*
          A plain div rather than a fieldset: the group caption is gone, and a
          fieldset without a legend is invalid. Each label carries its own field.
        */}
        {/* No address for the planner: the app sends no email, and the name
            and password below are what sign them back in. */}
        <div>
          <div>
            <label className="label" htmlFor="leader-name">
              Your name
            </label>
            <input
              id="leader-name"
              className="field min-h-11"
              value={leaderName}
              onChange={(event) => setLeaderName(event.target.value)}
              autoComplete="name"
              maxLength={60}
              required
            />
          </div>
          <div className="mt-3">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label className="label mb-0" htmlFor="leader-password">
                Your password
              </label>
              {/* Nothing in the app can reset this one, so a typo is permanent.
                  A reveal catches every mistyping; a confirm field only catches
                  the ones you would not repeat, and fights password managers.
                  The hit area is thumb-sized around a word-sized link; the
                  negative margins hand the extra height back to the row. */}
              <button
                type="button"
                className="btn-link -my-3 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center px-2"
                onClick={() => setShowPassword((shown) => !shown)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="leader-password"
              className="field min-h-11"
              type={showPassword ? 'text' : 'password'}
              value={leaderPassword}
              onChange={(event) => setLeaderPassword(event.target.value)}
              // new-password, so a password manager offers to save it. There is
              // no reset: a lost one cannot be recovered from anywhere.
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              required
            />
            <p className="hint mt-1">
              At least {MIN_PASSWORD_LENGTH} characters. You need it to sign back in as the event
              planner on another device.
            </p>
          </div>
        </div>

        <fieldset>
          <legend className="sr-only">Mode</legend>
          {/* One track, two halves, and a thumb that slides under whichever is
              chosen. Still a pair of radios underneath, so arrow keys move
              between them and a screen reader hears a choice of two. */}
          <div className="relative grid grid-cols-2 rounded-xl bg-line/60 p-1">
            <span
              aria-hidden="true"
              className={[
                'pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg border border-[#8fd4ae] bg-[#d9f2e4] shadow-sm',
                'transition-transform duration-200 ease-out motion-reduce:transition-none',
                mode === 'date_time' ? 'translate-x-full' : 'translate-x-0',
              ].join(' ')}
            />
            {(
              [
                { value: 'date_only' as const, title: 'Dates only' },
                { value: 'date_time' as const, title: 'Dates & times' },
              ] satisfies { value: EventMode; title: string }[]
            ).map((option) => (
              <label
                key={option.value}
                className={[
                  'relative flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-3 text-[0.9375rem] font-medium transition-colors',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                  mode === option.value ? 'text-[#0f4c33]' : 'text-muted hover:text-ink',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="mode"
                  className="sr-only"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => changeMode(option.value)}
                />
                {option.title}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <span className="label">Dates</span>
          <div className="panel p-3">
            <CreationCalendar key={mode} mode={mode} onChange={setDates} />
          </div>
        </div>

        {mode === 'date_time' ? (
          <>
            <fieldset>
              <legend className="label">Time window</legend>
              {/* Reads as a sentence, "9:00 AM to 5:00 PM", so the selects need
                  no visible labels of their own; screen readers get them from
                  aria-label, inside the fieldset's "Time window". */}
              <div className="flex items-center gap-2 sm:gap-3">
                <select
                  id="start-minute"
                  aria-label="Start time"
                  className="field num min-h-11 min-w-0 flex-1"
                  value={startMinute}
                  onChange={(event) => setStartMinute(Number(event.target.value))}
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
                  onChange={(event) => setEndMinute(Number(event.target.value))}
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
                {/* Full width on a phone, three equal thumb-sized segments;
                    back to a compact inline control once there is a pointer. */}
                <div className="flex w-full rounded-lg border border-line bg-surface p-0.5 sm:inline-flex sm:w-auto">
                  {GRANULARITIES.map((value) => (
                    <label
                      key={value}
                      className={[
                        'num flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-md px-3 text-[0.8125rem] sm:min-h-10 sm:flex-none',
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
            </fieldset>

            <div>
              <label className="label" htmlFor="timezone">
                Timezone
              </label>
              <select
                id="timezone"
                className="field min-h-11"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              >
                {zones.includes(timezone) ? null : <option value={timezone}>{timezone}</option>}
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className="hint mt-1">The grid is defined in this zone. Respondents can relabel it in theirs.</p>
            </div>
          </>
        ) : null}

        {/* Nothing below this line blocks creation. It stays open rather than
            folded away: one field is cheaper to read than a toggle is to find. */}
        <section aria-labelledby="optional-heading" className="space-y-7">
          <div className="flex items-center gap-3">
            <h2 id="optional-heading" className="section-title shrink-0 text-muted">
              Optional
            </h2>
            <span aria-hidden="true" className="h-px flex-1 bg-line" />
          </div>

          <EmailRequirementField
            required={emailRequired}
            onRequiredChange={setEmailRequired}
            prompt={emailPrompt}
            onPromptChange={setEmailPrompt}
          />
        </section>

        {error ? (
          <p className="rounded-lg border border-[#f0d4dc] bg-[#fdf3f5] px-3 py-2 text-[0.875rem] text-danger" role="alert">
            {error}
          </p>
        ) : null}

        {/* Phone only — see the note in app/page.tsx. Up here it would be the
            first thing between someone and the form; down here it is the last
            thing they read before committing, built as the button's twin so the
            two read as one stack rather than a banner that happens to be near. */}
        <StarBanner className="min-h-11 w-full sm:hidden" buttonSized />

        <button
          type="submit"
          className="btn btn-primary min-h-11 w-full sm:w-auto"
          disabled={submitting}
        >
          {created ? 'Event created' : submitting ? 'Creating…' : 'Create event'}
        </button>
      </form>

      {created ? (
        <ShareDialog
          url={created.url}
          eventTitle={title.trim()}
          onContinue={() => router.push(`/e/${created.slug}`)}
        />
      ) : null}
    </>
  );
}
