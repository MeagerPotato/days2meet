import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { findEventBySlug, findParticipantById, isLeaderRequest } from '@/lib/events';
import { jsonError, serverError } from '@/lib/http';
import { adminCookieName, cookieName, cookieOptions, readCookieValue } from '@/lib/session';
import { PARTICIPANTS_TABLE, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ slug: string; id: string }> },
) {
  try {
    const { slug, id } = await context.params;

    const event = await findEventBySlug(slug);
    if (!event) return jsonError('That event link does not exist. Check the URL and try again.', 404);

    // Postgres raises 22P02 on a malformed uuid, which would surface as a 500.
    if (!UUID_PATTERN.test(id)) return jsonError('That response has already been removed.', 404);

    // Scoped by event so a participant id from another event can never be used
    // to reach across into this one.
    const target = await findParticipantById(event.id, id);
    if (!target) return jsonError('That response has already been removed.', 404);

    // The leader's row backs the leader controls; deleting it nulls the pointer
    // to it and leaves the event with no owner the session can recover. Refuse
    // it, whoever is asking, rather than strand the controls.
    if (target.id === event.leader_participant_id) {
      return jsonError('The event planner cannot be removed from their own days2meet.', 403);
    }

    const store = await cookies();
    const sessionId = readCookieValue(store.get(cookieName(slug))?.value);
    const isSelf = sessionId !== null && sessionId === target.id;

    // Removing your own response needs no leadership, and answering that first
    // keeps the common case free of a token verify.
    const allowed =
      isSelf ||
      (await isLeaderRequest(event, sessionId, store.get(adminCookieName(slug))?.value));

    if (!allowed) {
      if (!sessionId) {
        return jsonError('You are signed out. Enter your name again to remove a response.', 401);
      }
      return jsonError('Only the event planner can remove someone else\'s response.', 403);
    }

    // Closing an event freezes the tally. The leader may still curate the roster,
    // but a respondent pulling their own row out after the fact would shrink the
    // very result everyone has been sent to read.
    if (isSelf && event.responses_closed) {
      return jsonError('This days2meet is closed, so responses can no longer be removed.', 403);
    }

    const { error } = await supabaseAdmin()
      .from(PARTICIPANTS_TABLE)
      .delete()
      .eq('id', target.id)
      .eq('event_id', event.id);

    if (error) throw new Error(error.message);

    // The session now points at a row that is gone, so retire it rather than
    // leave the browser looking signed in.
    if (isSelf) store.set(cookieName(slug), '', { ...cookieOptions(), maxAge: 0 });

    return NextResponse.json({ ok: true, selfRemoved: isSelf });
  } catch (error) {
    return serverError(error);
  }
}
