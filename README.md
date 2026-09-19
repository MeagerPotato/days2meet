# days2meet

A group availability poll — the same idea as When2meet — with one addition that matters: a
**mode** you choose when the event is created.

- **Dates & times** — the classic vertical time grid. A date range, a daily time window,
  painted by dragging rectangles. Anchored to one timezone, which each respondent can
  relabel in their own.
- **Dates only** — a month calendar where respondents mark whole days. No times, no
  timezone, no grid rows. This is the mode for far-off planning where hours are meaningless:
  winter break, a trip window, "which weekend in October".

Live at **https://days2meet.vercel.app**.

## How it works

Create an event and send the one link to everyone. Respondents type a name and start
marking — no account, no confirmation email. A password is optional for them, and only stops
other people editing their answer. The answers stack into a heat map, so the slot that suits
the most people is the darkest one on the screen.

The page does not poll. The group's answers load with the page and update when you press the
"Last updated … · Click to refresh" line above the group grid; your own marks show up at once.

Whoever creates the event is the **Event Planner**, and they give a name and a password up
front, but no email address. The password is not optional, because the event planner's name is
public in the roster: without one, anyone who read it could sign in as them and collect every
respondent's address. There is no reset, so it is worth saving.

The event planner gets an edit page where they can move the dates, change the time window,
close responses, export the roster as CSV, and remove a response. They can also require an
email address from respondents, with a short message of their own saying what it is for. The
app never sends email. Addresses are only stored so the event planner can see them in the
roster and the export, and nobody else sees them.

## Stack

Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, and Supabase for Postgres.
No client-side state library and no UI kit. Deployed on Vercel.
