import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import type { EventRow } from '@/lib/events';
import {
  claimLeader,
  countParticipants,
  findEventBySlug,
  findParticipantByEmail,
  findParticipantByName,
  hasValidAdminToken,
  MAX_PARTICIPANTS_PER_EVENT,
  readParticipantEmail,
} from '@/lib/events';
import { jsonError, readJsonBody, serverError } from '@/lib/http';
import { checkSigninRate, recordSigninFailure } from '@/lib/rate-limit';
import {
  looksLikeEmail,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  normalizeName,
} from '@/lib/identity';
import {
  adminCookieName,
  cookieName,
  cookieOptions,
  hashPassword,
  issueCookieValue,
  verifyPassword,
} from '@/lib/session';
import { PARTICIPANTS_TABLE, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const body = await readJsonBody(request);
    if (!body) return jsonError('Send a JSON object with a name.');

    // Either half can identify someone, so neither is required on its own; the
    // "you gave us nothing" check waits until both have been read.
    const name = normalizeName(body.name);
    if (name.length > MAX_NAME_LENGTH) {
      return jsonError(`Names are limited to ${MAX_NAME_LENGTH} characters.`);
    }

    const rawPassword = body.password;
    if (rawPassword !== undefined && rawPassword !== null && typeof rawPassword !== 'string') {
      return jsonError('The password has to be text.');
    }
    const password = typeof rawPassword === 'string' && rawPassword.length > 0 ? rawPassword : null;
    if (password && password.length > MAX_PASSWORD_LENGTH) {
      return jsonError(`Passwords are limited to ${MAX_PASSWORD_LENGTH} characters.`);
    }

    // Shape-checked here with the rest of the body, before the name is looked up,
    // so a malformed address never answers the question of who is on this event.
    const rawEmail = body.email;
    if (rawEmail !== undefined && rawEmail !== null && typeof rawEmail !== 'string') {
      return jsonError('The email has to be text.');
    }
    const submitted = typeof rawEmail === 'string' ? rawEmail.trim() : '';
    if (submitted.length > MAX_EMAIL_LENGTH) {
      return jsonError(`Email addresses are limited to ${MAX_EMAIL_LENGTH} characters.`);
    }
    if (submitted && !looksLikeEmail(submitted)) {
      return jsonError('That does not look like an email address.');
    }

    const event = await findEventBySlug(slug);
    if (!event) return jsonError('That event link does not exist. Check the URL and try again.', 404);

    // An event that does not ask for addresses must never accumulate them, so the
    // submitted value is dropped here and cannot reach an insert or an update.
    const email = event.collect_email ? submitted : '';
    if (!name && !email) return jsonError('Enter your name or your email address.');
    // A required address is asked of respondents only. Whether this is the
    // event planner is not known until the name has been looked up, so the
    // check itself waits below the lookup.
    const emailMissing = event.collect_email && event.email_required && !email;

    // Metered before any identity lookup, so a caller who has already burned
    // through failed guesses cannot reach a scrypt at all.
    const rate = await checkSigninRate(request);
    if (!rate.allowed) {
      const minutes = Math.max(1, Math.round(rate.retryAfterSeconds / 60));
      return jsonError(
        `Too many sign-in attempts from here. Try again in about ${minutes} ${
          minutes === 1 ? 'minute' : 'minutes'
        }.`,
        429,
        { 'retry-after': String(rate.retryAfterSeconds) },
      );
    }

    const client = supabaseAdmin();

    // The address wins over the name. Someone who cannot remember whether they
    // answered as "Sam" or "sam h" still lands on their own row instead of
    // starting a second one, and the name they typed this time is ignored rather
    // than renaming them.
    let existing = await findParticipantByEmail(event.id, email);
    const matchedByEmail = existing !== null;

    if (!existing) {
      if (!name) {
        return jsonError('No one has answered with that email yet. Enter your name to start.');
      }
      existing = await findParticipantByName(event.id, name);
    }

    // Everyone but the planner. The planner's row is made without an address
    // and signs back in with its name and password, so "required" there would
    // lock the event's own planner out of it. The password check further down
    // still applies to their row like any other.
    if (emailMissing && !(await isPlannerSignin(event, existing))) {
      return jsonError('Enter your email address.');
    }

    if (!existing) {
      // Closing an event stops it growing. Whoever already answered may still
      // sign in below to look at the results.
      if (event.responses_closed) {
        return jsonError('This days2meet is closed to new responses.', 403);
      }

      // A new name means a new row, so this is where a flood would land. The
      // ceiling keeps one event from being inflated until it is too big to load.
      if ((await countParticipants(event.id)) >= MAX_PARTICIPANTS_PER_EVENT) {
        return jsonError('This days2meet has as many responses as it can hold.', 409);
      }

      const { data, error } = await client
        .from(PARTICIPANTS_TABLE)
        .insert({
          event_id: event.id,
          name,
          password_hash: password ? await hashPassword(password) : null,
          slots: [],
          email: email || null,
        })
        .select('id, name, slots, updated_at')
        .single();

      if (error) {
        if (error.code !== '23505') throw new Error(error.message);
        // Two unique indexes can raise this. The address one means someone else
        // took it between the lookup above and this insert, which no amount of
        // checking first can prevent.
        if (isEmailConflict(error)) {
          return jsonError('That email has already answered. Sign in with it instead.');
        }
        // The name one: fall through and treat it as an existing name.
        existing = await findParticipantByName(event.id, name);
        if (!existing) throw new Error(error.message);
      } else {
        const created = data as { id: string; name: string; slots: number[] | null; updated_at: string };
        return await respondSignedIn(
          event,
          {
            id: created.id,
            name: created.name,
            slots: created.slots ?? [],
            updatedAt: created.updated_at,
            email: email || null,
          },
          // They just set this row up with an address and/or a password of their
          // own, which is proof enough to be shown that address again.
          Boolean(email) || Boolean(password),
        );
      }
    }

    let passwordIgnored = false;
    // Knowing the address this row was created with is proof enough on its own;
    // the password check below is the other way to earn it.
    let verified = matchedByEmail;

    if (existing.password_hash) {
      if (!password) {
        return jsonError('That name is password protected. Enter the password to edit it.', 401);
      }
      const matches = await verifyPassword(password, existing.password_hash);
      if (!matches) {
        // Only wrong guesses are counted, so the room of people signing in
        // correctly is never throttled — the script trying passwords is.
        await recordSigninFailure(request);
        return jsonError('That password does not match. Try again.', 401);
      }
      verified = true;
    } else if (password) {
      // The name was created without a password, so it is open to anyone. Setting
      // a password now would let a stranger lock out whoever answered first, so
      // the password is ignored and the client is told.
      passwordIgnored = true;
    }

    // The stored address is personal, so it is only read back or changed for a
    // proven identity. A name typed off the public roster is not proof, so a
    // name-only sign-in gets no address and cannot bind one — it may still edit
    // availability, which is what a password-less name was always open to.
    let storedEmail: string | null = null;
    if (verified) {
      if (email && !matchedByEmail) {
        // A verified holder may set or refresh their own address. The lookup
        // above found nobody else holding it, and the unique index catches
        // anyone who took it since.
        const { error } = await client
          .from(PARTICIPANTS_TABLE)
          .update({ email })
          .eq('id', existing.id)
          .eq('event_id', event.id);

        if (error) {
          if (error.code === '23505') {
            return jsonError('That email has already answered. Sign in with it instead.');
          }
          throw new Error(error.message);
        }
        storedEmail = email;
      } else {
        storedEmail = await readParticipantEmail(event.id, existing.id);
      }
    }

    return await respondSignedIn(
      event,
      {
        id: existing.id,
        name: existing.name,
        slots: existing.slots,
        updatedAt: existing.updated_at,
        email: storedEmail,
      },
      verified,
      passwordIgnored,
    );
  } catch (error) {
    return serverError(error);
  }
}

/**
 * Which of the two unique indexes on w2m_participants a 23505 came from. Named
 * in the message and the detail by Postgres; if a future driver stops reporting
 * it, this answers "not the email one" and the name path handles it or throws.
 */
function isEmailConflict(error: { message?: string | null; details?: string | null }): boolean {
  return /w2m_participants_event_email_idx/.test(`${error.message ?? ''} ${error.details ?? ''}`);
}

async function respondSignedIn(
  event: EventRow,
  participant: {
    id: string;
    name: string;
    slots: number[];
    updatedAt: string;
    email: string | null;
  },
  verified: boolean,
  passwordIgnored = false,
) {
  await claimLeadership(event, participant.id);

  const store = await cookies();
  store.set(cookieName(event.slug), issueCookieValue(participant.id, verified), cookieOptions());
  return NextResponse.json({ participant, passwordIgnored });
}

/**
 * Whether this signin is the event planner's, for the one rule they are exempt
 * from: a required email address.
 *
 * Normally that is simply "the row being signed into is the leader's". An older
 * event can still have no leader yet; its creator's first signin claims the role
 * (see `claimLeadership`) on the strength of the admin cookie, so the same proof
 * exempts them here. That path costs a scrypt verify, and is only reached when
 * the address is missing and the event has no leader at all.
 */
async function isPlannerSignin(
  event: EventRow,
  existing: { id: string } | null,
): Promise<boolean> {
  if (event.leader_participant_id !== null) {
    return existing !== null && existing.id === event.leader_participant_id;
  }
  const store = await cookies();
  return hasValidAdminToken(event.id, store.get(adminCookieName(event.slug))?.value);
}

/**
 * The creator becomes leader on their first signin, proven by the admin cookie
 * issued when they made the event. The free check comes first so an ordinary
 * signin never pays for a scrypt verify.
 */
async function claimLeadership(event: EventRow, participantId: string) {
  if (event.leader_participant_id !== null) return;

  const store = await cookies();
  if (!(await hasValidAdminToken(event.id, store.get(adminCookieName(event.slug))?.value))) return;

  await claimLeader(event.id, participantId);
}
