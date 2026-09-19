import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { findEventBySlug, geometryFromRow, isLeaderRequest, listParticipants } from '@/lib/events';
import { jsonError, serverError } from '@/lib/http';
import { adminCookieName, cookieName, readCookieValue } from '@/lib/session';
import { decodeSlot, slotsPerDay, type EventGeometry } from '@/lib/slots';
import type { ParticipantPayload } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The roster as a spreadsheet, for the leader only — it is the one view that
 * carries everyone's address.
 *
 * `date_only` events get a column per date with Yes or blank, which is what a
 * spreadsheet is for. `date_time` events get a single Available column of
 * coalesced ranges instead: a fortnight at quarter-hour granularity is 1,344
 * columns, which no one can read.
 */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;

    const event = await findEventBySlug(slug);
    if (!event) return jsonError('That event link does not exist. Check the URL and try again.', 404);

    const store = await cookies();
    const sessionId = readCookieValue(store.get(cookieName(slug))?.value);
    const allowed = await isLeaderRequest(event, sessionId, store.get(adminCookieName(slug))?.value);
    if (!allowed) {
      if (!sessionId) {
        return jsonError('You are signed out. Enter your name again to download the responses.', 401);
      }
      return jsonError('Only the event planner can download the responses.', 403);
    }

    const geometry = geometryFromRow(event);
    const participants = await listParticipants(event.id, true);
    // The byte order mark is what tells Excel this is UTF-8; without it a
    // respondent called Ana Muñoz opens as mojibake.
    const csv = `\ufeff${buildCsv(geometry, participants)}`;

    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${safeSlug(event.slug)}-respondents.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return serverError(error);
  }
}

function buildCsv(geometry: EventGeometry, participants: ParticipantPayload[]): string {
  const dateOnly = geometry.mode === 'date_only';
  const header = ['Name', 'Email', 'Responded at', ...(dateOnly ? geometry.dates : ['Available'])];

  const rows = participants.map((person) => {
    const marks = new Set(person.slots);
    const cells = dateOnly
      ? geometry.dates.map((_, index) => (marks.has(index) ? 'Yes' : ''))
      : [describeRanges(geometry, person.slots)];
    return [person.name, person.email ?? '', person.updatedAt, ...cells];
  });

  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** `2026-01-05 09:00–10:30; 2026-01-06 14:00–15:00`, one date at a time. */
function describeRanges(geometry: EventGeometry, slots: readonly number[]): string {
  const perDay = slotsPerDay(geometry);
  const start = geometry.startMinute ?? 0;
  const ordered = [...new Set(slots)].sort((a, b) => a - b);

  const out: string[] = [];
  let runDate = -1;
  let runFrom = 0;
  let runTo = 0;

  const close = () => {
    if (runDate < 0) return;
    const from = start + runFrom * geometry.slotMinutes;
    const to = start + (runTo + 1) * geometry.slotMinutes;
    out.push(`${geometry.dates[runDate]} ${clockTime(from)}–${clockTime(to)}`);
  };

  for (const slot of ordered) {
    const { dateIndex, rowIndex } = decodeSlot(geometry, slot);
    if (dateIndex < 0 || dateIndex >= geometry.dates.length || rowIndex >= perDay) continue;

    // A run only continues within one date; adjacent rows either side of
    // midnight are hours apart, not minutes.
    if (dateIndex === runDate && rowIndex === runTo + 1) {
      runTo = rowIndex;
      continue;
    }
    close();
    runDate = dateIndex;
    runFrom = rowIndex;
    runTo = rowIndex;
  }
  close();

  return out.join('; ');
}

/** 24-hour, so a window ending at midnight reads 24:00 rather than 12:00 AM. */
function clockTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * Excel and Sheets run a cell beginning =, +, - or @ as a formula, and these
 * cells are free text typed by strangers. A leading apostrophe forces the cell
 * to stay text; the quoting around it is ordinary RFC 4180.
 *
 * The tab, carriage return and line feed are in the guard too: a spreadsheet
 * strips a leading one of those and then runs the `=` that followed, which is
 * the known way past a `=+-@`-only guard. Today's columns are all trimmed or
 * numeric so none can begin that way, but the export gains new columns over
 * time and this keeps it safe whatever they hold.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return /["\n\r,]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** The slug reaches a header, and a quote in one would end the filename early. */
function safeSlug(slug: string): string {
  return slug.replace(/[^A-Za-z0-9_-]/g, '') || 'days2meet';
}
