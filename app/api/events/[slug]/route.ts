import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { isValidDateKey } from '@/lib/dates';
import type { EventPatch, EventRow } from '@/lib/events';
import {
  findEventBySlug,
  geometryFromRow,
  getEventPayload,
  isLeaderRequest,
  updateEvent,
} from '@/lib/events';
import { jsonError, readJsonBody, serverError } from '@/lib/http';
import { emailPromptProblem, normalizeEmailPrompt } from '@/lib/identity';
import { adminCookieName, cookieName, readCookieValue, readSession } from '@/lib/session';
import { ALLOWED_GRANULARITY, MAX_DATES, type EventGeometry } from '@/lib/slots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;

    // A refresh carries the viewer's own address back to them, so it has to know
    // who is asking — and whether they proved it, since only a verified session
    // is shown the address.
    const store = await cookies();
    const session = readSession(store.get(cookieName(slug))?.value);

    const payload = await getEventPayload(slug, session?.id ?? null, session?.verified ?? false);
    if (!payload) return jsonError('That event link does not exist. Check the URL and try again.', 404);

    return NextResponse.json(payload, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return serverError(error);
  }
}

/**
 * The leader's edit. Every field is optional; whatever is absent is left alone.
 *
 * Changing the dates or the time window moves every stored answer, so the reply
 * reports how many marks could not be carried across and how many people were
 * touched — the client owes its users that number.
 */
export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;

    const body = await readJsonBody(request);
    if (!body) return jsonError('Send a JSON object describing the change.');

    const event = await findEventBySlug(slug);
    if (!event) return jsonError('That event link does not exist. Check the URL and try again.', 404);

    const store = await cookies();
    const sessionId = readCookieValue(store.get(cookieName(slug))?.value);
    const allowed = await isLeaderRequest(event, sessionId, store.get(adminCookieName(slug))?.value);
    if (!allowed) {
      if (!sessionId) {
        return jsonError('You are signed out. Enter your name again to change this days2meet.', 401);
      }
      return jsonError('Only the event planner can change this days2meet.', 403);
    }

    // Both are baked into every stored slot index and every rendered label, so
    // changing either would quietly reinterpret answers that are already in.
    if (body.mode !== undefined) {
      return jsonError('An event cannot switch between whole days and times of day once it exists.');
    }
    if (body.timezone !== undefined) {
      return jsonError('The timezone cannot be changed once the event exists.');
    }

    const patch: EventPatch = {};

    if (body.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) return jsonError('Give the event a name.');
      if (title.length > 120) return jsonError('Event names are limited to 120 characters.');
      patch.title = title;
    }

    let dates = event.dates;
    if (body.dates !== undefined) {
      if (!Array.isArray(body.dates) || body.dates.length === 0) {
        return jsonError('Pick at least one date.');
      }
      if (body.dates.length > MAX_DATES) return jsonError(`Pick at most ${MAX_DATES} dates.`);
      for (const value of body.dates) {
        if (!isValidDateKey(value)) return jsonError('Dates must be formatted as YYYY-MM-DD.');
      }
      dates = [...new Set(body.dates as string[])].sort();
      patch.dates = dates;
    }

    const touchesTime =
      body.startMinute !== undefined || body.endMinute !== undefined || body.slotMinutes !== undefined;

    let startMinute = event.start_minute;
    let endMinute = event.end_minute;
    let slotMinutes = event.slot_minutes;

    if (touchesTime && event.mode === 'date_only') {
      return jsonError('This days2meet asks about whole days, so it has no times to change.');
    }

    if (touchesTime) {
      // All three move together. Changing only the granularity still has to
      // re-snap the window, or the row count stops being a whole number.
      const granularity = body.slotMinutes ?? event.slot_minutes;
      if (typeof granularity !== 'number' || !ALLOWED_GRANULARITY.includes(granularity)) {
        return jsonError('Granularity must be 15, 30, or 60 minutes.');
      }
      slotMinutes = granularity;

      const rawStart = body.startMinute ?? event.start_minute;
      const rawEnd = body.endMinute ?? event.end_minute;
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

      startMinute = Math.floor(rawStart / slotMinutes) * slotMinutes;
      endMinute = Math.ceil(rawEnd / slotMinutes) * slotMinutes;
      if (endMinute > 1440) endMinute = 1440;
      if (endMinute <= startMinute) {
        return jsonError('That time window is shorter than one slot. Widen it or use a smaller granularity.');
      }

      patch.start_minute = startMinute;
      patch.end_minute = endMinute;
      patch.slot_minutes = slotMinutes;
    }

    if (body.emailRequired !== undefined) {
      if (typeof body.emailRequired !== 'boolean') {
        return jsonError('The email requirement has to be true or false.');
      }
      patch.email_required = body.emailRequired;
    }

    // The planner's wording for the email box. Kept even while the address is
    // optional, so turning "required" off and on again brings their text back.
    // Null, empty or the untouched default all store null: "use the default".
    if (body.emailPrompt !== undefined) {
      const promptProblem = emailPromptProblem(body.emailPrompt);
      if (promptProblem) return jsonError(promptProblem);
      patch.email_prompt = normalizeEmailPrompt(body.emailPrompt);
    }

    if (body.responsesClosed !== undefined) {
      if (typeof body.responsesClosed !== 'boolean') {
        return jsonError('Closing responses has to be true or false.');
      }
      patch.responses_closed = body.responsesClosed;
    }

    if (Object.keys(patch).length === 0) return jsonError('Nothing to change.');

    const moved =
      !sameDates(event.dates, dates) ||
      startMinute !== event.start_minute ||
      endMinute !== event.end_minute ||
      slotMinutes !== event.slot_minutes;

    const geometry = moved
      ? {
          from: geometryFromRow(event),
          to: nextGeometry(event, dates, startMinute, endMinute, slotMinutes),
        }
      : null;

    const { dropped, affected } = await updateEvent(event, patch, geometry);
    return NextResponse.json({ ok: true, dropped, affected });
  } catch (error) {
    return serverError(error);
  }
}

function sameDates(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The row as it will be once the patch lands, in the shape the remap wants. */
function nextGeometry(
  row: EventRow,
  dates: string[],
  startMinute: number | null,
  endMinute: number | null,
  slotMinutes: number,
): EventGeometry {
  return { mode: row.mode, dates, timezone: row.timezone, slotMinutes, startMinute, endMinute };
}
