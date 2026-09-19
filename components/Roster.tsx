'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { ParticipantLite } from '@/lib/results';
import type { EventMode } from '@/lib/slots';

interface Props {
  participants: ParticipantLite[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
  meId: string | null;
  leaderId: string | null;
  mode: EventMode;
  slotMinutes: number;
  /** How many slots survive the intersection. Null when nobody is selected. */
  overlapCount: number | null;
  /** Resolves to an error message, or null once the response is gone. */
  onRemove: (id: string) => Promise<string | null>;
}

/** How much this person marked, in the unit the event is actually measured in. */
function describeAmount(slotCount: number, mode: EventMode, slotMinutes: number): string {
  if (slotCount === 0) return 'nothing yet';
  if (mode === 'date_only') return `${slotCount} ${slotCount === 1 ? 'day' : 'days'}`;

  const minutes = slotCount * slotMinutes;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Names double as an availability filter. Selecting several intersects them, so
 * you can ask "when are these three free" without dimming everyone else out of
 * the picture first.
 *
 * Removal is a two-step inside the row rather than a `confirm()` dialog: it
 * keeps the name you are about to delete on screen next to the button, and it
 * stays usable on touch where a system dialog is easy to dismiss by accident.
 */
export default function Roster({
  participants,
  selectedIds,
  onToggle,
  onClear,
  meId,
  leaderId,
  mode,
  slotMinutes,
  overlapCount,
  onRemove,
}: Props) {
  const picked = selectedIds.size;
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Addresses are only ever sent to the leader, so searching them only ever
  // matches on a screen that is already showing them.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return participants;
    return participants.filter(
      (person) =>
        person.name.toLowerCase().includes(needle) ||
        (person.email ?? '').toLowerCase().includes(needle),
    );
  }, [participants, query]);

  // A refresh can remove the row out from under an open confirmation.
  useEffect(() => {
    if (confirmId && !participants.some((person) => person.id === confirmId)) setConfirmId(null);
  }, [participants, confirmId]);

  // Opening the confirmation destroys the button that had focus. Land on Cancel
  // rather than Remove so a stray Enter backs out instead of deleting.
  useEffect(() => {
    if (confirmId) cancelRef.current?.focus();
  }, [confirmId]);

  const remove = async (id: string) => {
    setBusyId(id);
    const message = await onRemove(id);
    setBusyId(null);
    setConfirmId(null);
    setError(message);
  };

  const hint = (() => {
    if (picked === 0) return 'Pick names to see where they overlap. Pick as many as you like.';
    if (overlapCount === 0) {
      return picked === 1
        ? 'This person has not marked anything yet.'
        : `No overlap between these ${picked}.`;
    }
    return picked === 1
      ? 'Showing one person. Pick another name to intersect them.'
      : `Showing where all ${picked} overlap.`;
  })();

  return (
    <section aria-labelledby="roster-heading" className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-3 py-2">
        <h3 id="roster-heading" className="section-title">
          Who has answered
        </h3>
        <span className="hint num shrink-0">
          ({participants.length} {participants.length === 1 ? 'response' : 'responses'})
        </span>
        <input
          type="search"
          // Full tap height on a phone, back to compact once a pointer is
          // doing the aiming.
          className="ml-auto min-h-11 min-w-0 flex-1 basis-28 rounded-md border border-line bg-surface px-2 py-1 text-[0.8125rem] placeholder:text-muted sm:min-h-0"
          placeholder="Search"
          aria-label="Search who has answered"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="border-b border-line bg-[#fdf3f5] px-3 py-2 text-[0.8125rem] text-danger"
        >
          {error}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <p className="px-3 py-3 text-[0.8125rem] text-muted">No one matches that.</p>
      ) : null}

      <ul>
        {shown.map((person) => {
          const active = selectedIds.has(person.id);
          const isMe = person.id === meId;
          const canRemove = meId !== null && (isMe || meId === leaderId);

          if (confirmId === person.id) {
            return (
              <li key={person.id} className="border-b border-line last:border-b-0 bg-[#fdf3f5]">
                <div
                  className="flex flex-wrap items-center gap-2 px-3 py-2"
                  onKeyDown={(keyEvent) => {
                    if (keyEvent.key === 'Escape') setConfirmId(null);
                  }}
                >
                  <span className="min-w-0 flex-1 text-[0.8125rem]">
                    Remove <span className="font-semibold">{person.name}</span>
                    {isMe ? ' — your own response' : ''}?
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger min-h-11 sm:min-h-0"
                    disabled={busyId === person.id}
                    onClick={() => void remove(person.id)}
                  >
                    {busyId === person.id ? 'Removing…' : 'Remove'}
                  </button>
                  {/* A full button, not a text link: this sits next to a destructive
                      action and needs a real tap target on touch. */}
                  <button
                    ref={cancelRef}
                    type="button"
                    className="btn min-h-11 sm:min-h-0"
                    onClick={() => setConfirmId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </li>
            );
          }

          return (
            <li key={person.id} className="flex items-stretch border-b border-line last:border-b-0">
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onToggle(person.id)}
                className={[
                  'flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-3 py-1.5 text-left transition-colors',
                  active ? 'bg-ramp-1' : 'hover:bg-[#f6f7f9]',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className={[
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[0.625rem] leading-none',
                    active
                      ? 'border-ramp-5 bg-ramp-5 text-paper'
                      : 'border-line bg-surface text-transparent',
                  ].join(' ')}
                >
                  ✓
                </span>
                <span className="min-w-0 truncate text-[0.875rem]">
                  <span className="font-medium">{person.name}</span>
                  {person.email ? <span className="text-muted"> ({person.email})</span> : null}
                </span>
                {person.id === leaderId ? (
                  <span className="shrink-0 rounded-full border border-ramp-3 bg-ramp-1 px-1.5 py-px text-[0.625rem] font-semibold uppercase tracking-wide text-accent">
                    Event Planner
                  </span>
                ) : null}
                {isMe ? <span className="hint shrink-0 text-[0.75rem]">(you)</span> : null}
                <span className="num ml-auto shrink-0 pl-1 text-[0.75rem] text-muted">
                  {describeAmount(person.slots.length, mode, slotMinutes)}
                </span>
              </button>

              {canRemove ? (
                <button
                  type="button"
                  aria-label={`Remove ${person.name}${isMe ? ' — your own response' : ''}`}
                  onClick={() => {
                    setConfirmId(person.id);
                    setError(null);
                  }}
                  className="flex w-11 shrink-0 cursor-pointer items-center justify-center border-l border-line text-muted transition-colors hover:bg-[#fdf3f5] hover:text-danger"
                >
                  <span aria-hidden="true" className="text-[1.125rem] leading-none">
                    ×
                  </span>
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2">
        <p className="hint min-w-0" aria-live="polite">
          {hint}
        </p>
        {picked > 0 ? (
          <button
            type="button"
            className="btn-link -my-2 shrink-0 py-2 sm:my-0 sm:py-0"
            onClick={onClear}
          >
            Show everyone
          </button>
        ) : null}
      </div>
    </section>
  );
}
