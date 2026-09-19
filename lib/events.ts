/**
 * Server-side data access for events and participants.
 *
 * Every participant read that can reach the client selects an explicit column
 * list. `password_hash` is only ever selected by the two lookups that exist to
 * verify a password, and neither returns its row to a caller that serialises it.
 * `admin_token_hash` is kept out of EVENT_COLUMNS for the same reason:
 * `readAdminTokenHash` is its only reader and it is private to this module.
 *
 * Participant `email` is likewise out of PARTICIPANT_PUBLIC_COLUMNS, so no
 * caller gets addresses by accident. Exactly three readers ask for it:
 * `readParticipantEmail` and `findParticipantByEmail`, both one row at a time,
 * and `listParticipants(id, true)`, whose second argument is set only after the
 * caller has established that the viewer is the group leader.
 */

import { EVENTS_TABLE, PARTICIPANTS_TABLE, supabaseAdmin } from './supabase.ts';
import { verifyPassword } from './session.ts';
import { remapSlots, type EventGeometry, type EventMode } from './slots.ts';
import type { EventPayload, ParticipantPayload } from './types.ts';

export interface EventRow {
  id: string;
  slug: string;
  title: string;
  mode: EventMode;
  dates: string[];
  timezone: string | null;
  start_minute: number | null;
  end_minute: number | null;
  slot_minutes: number;
  created_at: string;
  leader_participant_id: string | null;
  collect_email: boolean;
  email_required: boolean;
  /** The planner's wording for the email box; null means the default. */
  email_prompt: string | null;
  responses_closed: boolean;
}

const EVENT_COLUMNS =
  'id, slug, title, mode, dates, timezone, start_minute, end_minute, slot_minutes, created_at, leader_participant_id, collect_email, email_required, email_prompt, responses_closed';
const PARTICIPANT_PUBLIC_COLUMNS = 'id, name, slots, updated_at';
const PARTICIPANT_LEADER_COLUMNS = 'id, name, slots, updated_at, email';

interface ParticipantRecord {
  id: string;
  name: string;
  slots: number[] | null;
  updated_at: string;
  email?: string | null;
}

/**
 * A ceiling on how many people one event may hold. Set far above any real
 * gathering this app is for, so it never troubles a genuine poll, but low enough
 * that a script cannot inflate a roster without bound — every extra row is
 * loaded and re-serialised to every viewer on each load, so an unbounded roster
 * is a denial-of-service on the very people trying to use it.
 */
export const MAX_PARTICIPANTS_PER_EVENT = 500;

export function geometryFromRow(row: EventRow): EventGeometry {
  return {
    mode: row.mode,
    dates: row.dates,
    timezone: row.timezone,
    slotMinutes: row.slot_minutes,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
  };
}

/** How many people have answered, for the per-event ceiling. */
export async function countParticipants(eventId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from(PARTICIPANTS_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function findEventBySlug(slug: string): Promise<EventRow | null> {
  const { data, error } = await supabaseAdmin()
    .from(EVENTS_TABLE)
    .select(EVENT_COLUMNS)
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as EventRow | null) ?? null;
}

/**
 * `includeEmail` is the one door to the whole roster's addresses. Only pass true
 * once you have established that the viewer is the group leader.
 */
export async function listParticipants(
  eventId: string,
  includeEmail = false,
): Promise<ParticipantPayload[]> {
  const client = supabaseAdmin();
  // Two whole statements rather than one with a chosen column list, because
  // supabase-js parses `select()` at the type level and only understands a
  // literal.
  const { data, error } = includeEmail
    ? await client
        .from(PARTICIPANTS_TABLE)
        .select(PARTICIPANT_LEADER_COLUMNS)
        .eq('event_id', eventId)
        .order('created_at', { ascending: true })
    : await client
        .from(PARTICIPANTS_TABLE)
        .select(PARTICIPANT_PUBLIC_COLUMNS)
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  return ((data ?? []) as ParticipantRecord[]).map((record) => ({
    id: record.id,
    name: record.name,
    slots: record.slots ?? [],
    updatedAt: record.updated_at,
    email: includeEmail ? record.email ?? null : null,
  }));
}

export function toEventPayload(
  row: EventRow,
  participants: ParticipantPayload[],
  viewerEmail: string | null = null,
  viewerIsLeader = false,
): EventPayload {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    mode: row.mode,
    dates: row.dates,
    timezone: row.timezone,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    slotMinutes: row.slot_minutes,
    createdAt: row.created_at,
    leaderId: row.leader_participant_id,
    collectEmail: row.collect_email,
    emailRequired: row.email_required,
    emailPrompt: row.email_prompt ?? null,
    responsesClosed: row.responses_closed,
    viewerIsLeader,
    viewerEmail,
    participants,
  };
}

/**
 * `viewerId` is the caller's own participant id, read from their signed session
 * cookie. It buys them their own address back, and the whole roster's addresses
 * only when it is the leader's own id.
 *
 * The creator's admin cookie also counts as the leader for permissions, but not
 * here: this payload is rendered on every page load and refetched on every
 * refresh, and asking it to verify a token would cost a scrypt each time. Someone holding that cookie can
 * sign in and get the same view.
 */
export async function getEventPayload(
  slug: string,
  viewerId?: string | null,
  viewerVerified = false,
): Promise<EventPayload | null> {
  const row = await findEventBySlug(slug);
  if (!row) return null;

  const viewerIsLeader = viewerId != null && viewerId === row.leader_participant_id;
  const participants = await listParticipants(row.id, viewerIsLeader);
  // The address is only handed back to someone who proved they own it. A
  // name-only session is unverified, so a stranger who signed in with a public
  // name gets no email — neither their target's nor anyone's — on any fetch.
  const canSeeEmail = viewerId != null && (viewerIsLeader || viewerVerified);
  const viewerEmail = canSeeEmail ? await readParticipantEmail(row.id, viewerId) : null;
  return toEventPayload(row, participants, viewerEmail, viewerIsLeader);
}

async function readAdminTokenHash(eventId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from(EVENTS_TABLE)
    .select('admin_token_hash')
    .eq('id', eventId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as { admin_token_hash: string | null } | null)?.admin_token_hash ?? null;
}

/**
 * Proof that this browser created the event. A missing cookie or a missing
 * stored hash is a fail, never a pass — otherwise any visitor to an event that
 * predates admin tokens could send junk and win the role.
 */
export async function hasValidAdminToken(
  eventId: string,
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  // The real token is always 32 bytes of hex (see `newAdminToken`). Rejecting
  // anything else here means a junk cookie is turned away for the cost of a
  // regex, not a database round trip and a scrypt — so it cannot be used to make
  // an unauthenticated request burn either.
  if (!/^[0-9a-f]{64}$/.test(token)) return false;

  const hash = await readAdminTokenHash(eventId);
  if (!hash) return false;

  return verifyPassword(token, hash);
}

/**
 * Leader for permission purposes: the signed-in leader, or the creator holding
 * the admin cookie. The free comparison comes first so an ordinary leader action
 * never pays for a scrypt verify.
 */
export async function isLeaderRequest(
  event: EventRow,
  sessionId: string | null,
  adminToken: string | undefined,
): Promise<boolean> {
  if (sessionId !== null && sessionId === event.leader_participant_id) return true;
  return hasValidAdminToken(event.id, adminToken);
}

/**
 * Reads `w2m_participants.email` for one participant, so no caller can turn the
 * column into a list of addresses.
 */
export async function readParticipantEmail(
  eventId: string,
  participantId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from(PARTICIPANTS_TABLE)
    .select('email')
    .eq('event_id', eventId)
    .eq('id', participantId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as { email: string | null } | null)?.email ?? null;
}

/**
 * Fills the leader slot only while it is still empty, so two creators racing
 * with the same admin cookie cannot take the role from each other.
 */
export async function claimLeader(eventId: string, participantId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from(EVENTS_TABLE)
    .update({ leader_participant_id: participantId })
    .eq('id', eventId)
    .is('leader_participant_id', null);

  if (error) throw new Error(error.message);
}

/**
 * The creator's own row, written straight after the event they just made.
 *
 * A brand-new event has no other participants, so the name index has nothing
 * to collide with and this cannot raise a 23505. The row carries no address:
 * the planner is never asked for one, since the app sends no email and their
 * name and password are what sign them back in.
 *
 * `passwordHash` is required rather than optional, unlike a respondent's: this
 * row owns the leader controls, so leaving the column null would hand them to
 * anyone who read the leader's name off the roster and typed it back.
 */
export async function createLeaderParticipant(
  eventId: string,
  name: string,
  passwordHash: string,
): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from(PARTICIPANTS_TABLE)
    .insert({ event_id: eventId, name, slots: [], email: null, password_hash: passwordHash })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/**
 * Only for unwinding an event whose creation could not be finished — see the
 * ordering note in the create route. The cascade on w2m_participants.event_id
 * takes any rows written in the meantime with it.
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const { error } = await supabaseAdmin().from(EVENTS_TABLE).delete().eq('id', eventId);
  if (error) throw new Error(error.message);
}

/** What signin needs to decide who someone is and whether they may edit. */
export interface ParticipantIdentity {
  id: string;
  name: string;
  password_hash: string | null;
  slots: number[];
  updated_at: string;
}

/**
 * Case-insensitive name lookup. Matching happens here rather than in a SQL
 * `ilike` because a name containing `%` or `_` would otherwise match as a
 * wildcard. Participant counts are small enough that this is free.
 */
export async function findParticipantByName(
  eventId: string,
  name: string,
): Promise<ParticipantIdentity | null> {
  const { data, error } = await supabaseAdmin()
    .from(PARTICIPANTS_TABLE)
    .select('id, name, password_hash, slots, updated_at')
    .eq('event_id', eventId);

  if (error) throw new Error(error.message);

  const target = name.toLowerCase();
  const match = (data ?? []).find(
    (row) => (row as { name: string }).name.toLowerCase() === target,
  );
  if (!match) return null;

  const record = match as {
    id: string;
    name: string;
    password_hash: string | null;
    slots: number[] | null;
    updated_at: string;
  };
  return { ...record, slots: record.slots ?? [] };
}

/**
 * The same shape as the name lookup, so signin can resolve an identity from
 * either without special-casing. Matching is in JS for the wildcard reason
 * above, which bites harder here: `_` is ordinary in an address, so an `ilike`
 * on `a_b@x.com` would happily answer with `axb@x.com` — someone else's row.
 *
 * `email` is selected for the whole event but only one row ever leaves, and the
 * address itself never does.
 */
export async function findParticipantByEmail(
  eventId: string,
  email: string,
): Promise<ParticipantIdentity | null> {
  // Rows with no address compare as '', so an empty needle would match one of
  // them and hand back a stranger's identity.
  if (!email) return null;

  const { data, error } = await supabaseAdmin()
    .from(PARTICIPANTS_TABLE)
    .select('id, name, password_hash, slots, updated_at, email')
    .eq('event_id', eventId);

  if (error) throw new Error(error.message);

  const target = email.toLowerCase();
  const match = (data ?? []).find(
    (row) => ((row as { email: string | null }).email ?? '').toLowerCase() === target,
  );
  if (!match) return null;

  const record = match as {
    id: string;
    name: string;
    password_hash: string | null;
    slots: number[] | null;
    updated_at: string;
  };
  return {
    id: record.id,
    name: record.name,
    password_hash: record.password_hash,
    slots: record.slots ?? [],
    updated_at: record.updated_at,
  };
}

export async function findParticipantById(
  eventId: string,
  participantId: string,
): Promise<ParticipantPayload | null> {
  const { data, error } = await supabaseAdmin()
    .from(PARTICIPANTS_TABLE)
    .select(PARTICIPANT_PUBLIC_COLUMNS)
    .eq('event_id', eventId)
    .eq('id', participantId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const record = data as { id: string; name: string; slots: number[] | null; updated_at: string };
  return {
    id: record.id,
    name: record.name,
    slots: record.slots ?? [],
    updatedAt: record.updated_at,
    email: null,
  };
}

/** Columns the leader may change after an event exists. */
export interface EventPatch {
  title?: string;
  dates?: string[];
  start_minute?: number;
  end_minute?: number;
  slot_minutes?: number;
  email_required?: boolean;
  email_prompt?: string | null;
  responses_closed?: boolean;
}

export interface EventUpdateResult {
  /** Input slots across all participants that found no home on the new grid. */
  dropped: number;
  /** Participants whose stored slots actually changed. */
  affected: number;
}

/**
 * Applies a leader's edit and, when the grid moved underneath them, carries
 * every stored answer across to the new one.
 *
 * There is no transaction available here, so this is ordered rather than
 * atomic: every remap is computed before anything is written, the participant
 * rows go next, and the event row goes last. A failure part-way throws, so the
 * request 500s with some answers moved and the event still on its old geometry.
 * That is the better half of a bad choice — moving the dates first would leave
 * a live grid whose columns silently point at answers nobody gave.
 *
 * `updated_at` is deliberately left alone: nobody answered again, and the
 * roster's "last edited" should not lie about that.
 */
export async function updateEvent(
  row: EventRow,
  patch: EventPatch,
  geometry: { from: EventGeometry; to: EventGeometry } | null,
): Promise<EventUpdateResult> {
  const client = supabaseAdmin();
  let dropped = 0;
  let affected = 0;

  if (geometry) {
    const { data, error } = await client
      .from(PARTICIPANTS_TABLE)
      .select('id, slots')
      .eq('event_id', row.id);

    if (error) throw new Error(error.message);

    const rewrites: { id: string; slots: number[] }[] = [];
    for (const record of (data ?? []) as { id: string; slots: number[] | null }[]) {
      const before = record.slots ?? [];
      const remapped = remapSlots(geometry.from, geometry.to, before);
      dropped += remapped.dropped;
      if (!sameSlots(before, remapped.slots)) {
        rewrites.push({ id: record.id, slots: remapped.slots });
      }
    }

    for (const rewrite of rewrites) {
      const { error: writeError } = await client
        .from(PARTICIPANTS_TABLE)
        .update({ slots: rewrite.slots })
        .eq('id', rewrite.id)
        .eq('event_id', row.id);

      if (writeError) throw new Error(writeError.message);
      affected += 1;
    }
  }

  const { error } = await client.from(EVENTS_TABLE).update(patch).eq('id', row.id);
  if (error) throw new Error(error.message);

  return { dropped, affected };
}

function sameSlots(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
