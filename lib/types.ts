import type { EventMode } from './slots.ts';

export interface ParticipantPayload {
  id: string;
  name: string;
  slots: number[];
  updatedAt: string;
  /**
   * Filled in only when the viewer asking for this payload is the group leader.
   * For everyone else it is null on every participant, because anyone holding
   * the share link can fetch the roster and a share link must not double as a
   * mailing list.
   */
  email: string | null;
}

/** Shape of `GET /api/events/[slug]`. Never carries `password_hash`. */
export interface EventPayload {
  id: string;
  slug: string;
  title: string;
  mode: EventMode;
  dates: string[];
  timezone: string | null;
  startMinute: number | null;
  endMinute: number | null;
  slotMinutes: number;
  createdAt: string;
  leaderId: string | null;
  /**
   * Always true today. The field stays so that bringing back a "don't ask for
   * an address at all" option needs no migration.
   */
  collectEmail: boolean;
  emailRequired: boolean;
  /**
   * The event planner's own wording for the email box, shown when
   * `emailRequired` is on. Null means "use DEFAULT_EMAIL_PROMPT" (lib/identity.ts).
   */
  emailPrompt: string | null;
  /** Closed events still show their results; they just take no new answers. */
  responsesClosed: boolean;
  /** Whether the viewer's own session is the leader's. Gates the leader UI. */
  viewerIsLeader: boolean;
  /**
   * The requesting viewer's own address and nobody else's. Anyone holding the
   * link can fetch this payload, so a list of respondent emails would turn a
   * share link into a mailing list.
   */
  viewerEmail: string | null;
  participants: ParticipantPayload[];
}

export interface ApiError {
  error: string;
}

// Who counts as whom — names, addresses, passwords — lives in lib/identity.ts,
// which both doors into an event share.
