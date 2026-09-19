import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';

import { isValidDateKey } from '@/lib/dates';
import { claimLeader, createLeaderParticipant, deleteEvent } from '@/lib/events';
import {
  adminCookieName,
  cookieName,
  cookieOptions,
  hashPassword,
  issueCookieValue,
  newAdminToken,
} from '@/lib/session';
import { ALLOWED_GRANULARITY, MAX_DATES } from '@/lib/slots';
import { EVENTS_TABLE, supabaseAdmin } from '@/lib/supabase';
import { isValidTimeZone } from '@/lib/timezone';
import { jsonError, readJsonBody, serverError } from '@/lib/http';
import { recordCreationAttempt } from '@/lib/rate-limit';
import {
  emailPromptProblem,
  leaderPasswordProblem,
  MAX_NAME_LENGTH,
  normalizeEmailPrompt,
  normalizeName,
} from '@/lib/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    if (!body) return jsonError('Send a JSON object describing the event.');

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return jsonError('Give the event a name.');
    if (title.length > 120) return jsonError('Event names are limited to 120 characters.');

    const leaderName = normalizeName(body.leaderName);
    if (!leaderName) return jsonError('Enter your name so everyone knows who the event planner is.');
    if (leaderName.length > MAX_NAME_LENGTH) {
      return jsonError(`Names are limited to ${MAX_NAME_LENGTH} characters.`);
    }

    // The planner is not asked for an address: the app sends no email, and
    // their name and password are what sign them back in. A `leaderEmail` from
    // an older client is ignored rather than rejected, so it cannot fail on it,
    // and it is never stored.

    // The form checks the same rule, but this is the control: the route is
    // reachable without it.
    const passwordProblem = leaderPasswordProblem(body.leaderPassword);
    if (passwordProblem) return jsonError(passwordProblem);
    const leaderPassword = body.leaderPassword as string;

    const mode = body.mode;
    if (mode !== 'date_time' && mode !== 'date_only') {
      return jsonError('Mode must be either "date_time" or "date_only".');
    }

    if (!Array.isArray(body.dates) || body.dates.length === 0) {
      return jsonError('Pick at least one date.');
    }
    if (body.dates.length > MAX_DATES) {
      return jsonError(`Pick at most ${MAX_DATES} dates.`);
    }
    for (const value of body.dates) {
      if (!isValidDateKey(value)) return jsonError('Dates must be formatted as YYYY-MM-DD.');
    }
    const dates = [...new Set(body.dates as string[])].sort();

    const rawEmailRequired = body.emailRequired;
    if (rawEmailRequired !== undefined && rawEmailRequired !== null && typeof rawEmailRequired !== 'boolean') {
      return jsonError('The email requirement has to be true or false.');
    }
    // Every event asks for an address now; the only choice left is whether it is
    // required. The column stays so that bringing the option back needs no
    // migration, and a submitted `collectEmail` is ignored rather than rejected
    // so an older client cannot fail on it.
    const collectEmail = true;
    const emailRequired = rawEmailRequired === true;

    // What respondents read over the email box. Only meaningful while the
    // address is required, so it is validated always but stored only then;
    // null (including the untouched default) means "use the default wording".
    const promptProblem = emailPromptProblem(body.emailPrompt);
    if (promptProblem) return jsonError(promptProblem);
    const emailPrompt = emailRequired ? normalizeEmailPrompt(body.emailPrompt) : null;

    let timezone: string | null = null;
    let startMinute: number | null = null;
    let endMinute: number | null = null;
    let slotMinutes = 15;

    if (mode === 'date_time') {
      if (!isValidTimeZone(body.timezone)) {
        return jsonError('Pick a timezone from the list.');
      }
      timezone = body.timezone;

      const granularity = body.slotMinutes;
      if (typeof granularity !== 'number' || !ALLOWED_GRANULARITY.includes(granularity)) {
        return jsonError('Granularity must be 15, 30, or 60 minutes.');
      }
      slotMinutes = granularity;

      const rawStart = body.startMinute;
      const rawEnd = body.endMinute;
      if (
        typeof rawStart !== 'number' ||
        typeof rawEnd !== 'number' ||
        !Number.isInteger(rawStart) ||
        !Number.isInteger(rawEnd) ||
        rawStart < 0 ||
        rawEnd > 1440 ||
        rawStart >= rawEnd
      ) {
        return jsonError('The end time has to come after the start time, on the same day.');
      }

      // Snap the window outward to the granularity so the row count is always a
      // whole number and lib/slots.ts never has to round.
      startMinute = Math.floor(rawStart / slotMinutes) * slotMinutes;
      endMinute = Math.ceil(rawEnd / slotMinutes) * slotMinutes;
      if (endMinute > 1440) endMinute = 1440;
      if (endMinute <= startMinute) {
        return jsonError('That time window is shorter than one slot. Widen it or use a smaller granularity.');
      }
    }

    // Metered here and not a line earlier: everything above only reads the body,
    // so a malformed request costs the sender nothing. Everything below writes
    // rows or burns scrypt, which is the part worth rationing.
    const verdict = await recordCreationAttempt(request);
    if (!verdict.allowed) {
      const minutes = Math.max(1, Math.round(verdict.retryAfterSeconds / 60));
      return jsonError(
        `That is a lot of events from one place. Try again in about ${minutes} ${
          minutes === 1 ? 'minute' : 'minutes'
        }.`,
        429,
        { 'retry-after': String(verdict.retryAfterSeconds) },
      );
    }

    const client = supabaseAdmin();
    let lastError: string | null = null;
    let created: { id: string; slug: string } | null = null;

    // Proof that this browser made the event, which backs its leader controls
    // even after the session cookie below is gone. Hashed once outside the loop
    // so a slug collision does not pay for a second scrypt; the token is already
    // 256 bits of entropy, so hashing it is belt and braces rather than a
    // requirement.
    const adminToken = newAdminToken();
    const adminTokenHash = await hashPassword(adminToken);
    // Hashed here, alongside the admin token and before any row exists, so a
    // scrypt failure aborts with nothing to unwind rather than leaving the block
    // below to delete a live event. Only the hash travels on from here.
    const leaderPasswordHash = await hashPassword(leaderPassword);

    for (let attempt = 0; attempt < 4; attempt++) {
      const slug = nanoid(10);
      const { data, error } = await client
        .from(EVENTS_TABLE)
        .insert({
          slug,
          title,
          mode,
          dates,
          timezone,
          start_minute: startMinute,
          end_minute: endMinute,
          slot_minutes: slotMinutes,
          collect_email: collectEmail,
          email_required: emailRequired,
          email_prompt: emailPrompt,
          admin_token_hash: adminTokenHash,
        })
        .select('id, slug')
        .single();

      if (!error && data) {
        created = data as { id: string; slug: string };
        break;
      }
      // 23505 is a unique violation, which here can only be the slug.
      if (error && error.code !== '23505') throw new Error(error.message);
      lastError = error?.message ?? null;
    }

    if (!created) {
      throw new Error(lastError ?? 'Could not allocate a unique link for this event.');
    }

    // The foreign key on w2m_participants.event_id means the event row has to
    // exist before the leader's can, and supabase-js has no transaction to bind
    // the pair. So the event goes first and is deleted again if anything after
    // it fails: its slug has not left this function yet, so nobody can be
    // holding a link to it, and no event at all beats a live one whose leader
    // controls answer to nobody. Everything that has to succeed before the slug
    // escapes therefore sits inside this block, cookies included.
    try {
      const leaderId = await createLeaderParticipant(created.id, leaderName, leaderPasswordHash);
      await claimLeader(created.id, leaderId);

      const store = await cookies();
      // The raw token leaves the server only here, in an httpOnly cookie.
      store.set(adminCookieName(created.slug), adminToken, cookieOptions());
      // The same session signin issues, so the creator lands on their event
      // already signed in instead of being asked for what they just typed. They
      // chose the password a moment ago, so the session is verified.
      store.set(cookieName(created.slug), issueCookieValue(leaderId, true), cookieOptions());
    } catch (failure) {
      await deleteEvent(created.id).catch((cleanup) => {
        console.error('[days2meet] could not unwind a half-made event', cleanup);
      });
      throw failure;
    }

    return NextResponse.json({ slug: created.slug }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}
