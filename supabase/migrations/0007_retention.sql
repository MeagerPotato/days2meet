-- Retention: an event is deleted once BOTH
--   * its last candidate date is more than six months in the past, and
--   * nothing has touched it for six months — no planner edit, and no
--     respondent joining or changing their answer.
-- Either one alone keeps it: a far-future event nobody has opened in a while
-- stays, and so does a finished event people are still looking at.
-- Participants go with their event through the existing cascade.

-- Planner edits (title, dates, closing responses) change the event row, not
-- any participant, so the event needs its own clock. Existing rows start at
-- now(), which errs toward keeping them.
alter table public.w2m_events
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.w2m_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists w2m_events_touch on public.w2m_events;
create trigger w2m_events_touch
  before update on public.w2m_events
  for each row execute function public.w2m_touch_updated_at();

create or replace function public.w2m_purge_stale_events()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  purged integer;
begin
  delete from public.w2m_events e
  where (select max(d) from unnest(e.dates) as d) < (current_date - interval '6 months')::date
    and greatest(e.created_at, e.updated_at) < now() - interval '6 months'
    and not exists (
      select 1
      from public.w2m_participants p
      where p.event_id = e.id
        and p.updated_at >= now() - interval '6 months'
    );
  get diagnostics purged = row_count;
  return purged;
end;
$$;

-- Functions in `public` are callable over the Data API by default. These are
-- for the scheduler alone.
revoke execute on function public.w2m_purge_stale_events() from public, anon, authenticated;
revoke execute on function public.w2m_touch_updated_at() from public, anon, authenticated;

-- Supabase Cron. Runs daily at 09:17 UTC; scheduling by name replaces any
-- earlier definition, so re-running this file is harmless.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule(
  'w2m-purge-stale-events',
  '17 9 * * *',
  $$select public.w2m_purge_stale_events()$$
);
